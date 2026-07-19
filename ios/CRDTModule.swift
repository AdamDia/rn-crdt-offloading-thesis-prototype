import Foundation
import React

@objc(CRDTModule)
final class CRDTModule: NSObject {
  private struct LWWState {
    var value: String
    var timestamp: Double
    var replicaId: String
  }

  private let queue = DispatchQueue(label: "crdt.queue", qos: .userInitiated)
  private var state: [String: Int] = [:]
  private var lwwState = LWWState(value: "", timestamp: 0, replicaId: "")
  private let allowedDashboardSizes: Set<Int> = [1000, 5000, 10000]
  private let dashboardWindowSize = 20
  private let dashboardSampleSize = 60

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  private func isValidReplicaId(_ replicaId: String) -> Bool {
    return !replicaId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func totalValue() -> Int {
    var sum: Int = 0
    for (_, v) in state {
      if v >= 0 {
        sum += v
      }
    }
    return sum
  }

  private func isValidTimestamp(_ timestamp: Double) -> Bool {
    return timestamp.isFinite
  }

  private func isIncomingLWWStateNewer(_ incoming: LWWState, than current: LWWState) -> Bool {
    if incoming.timestamp != current.timestamp {
      return incoming.timestamp > current.timestamp
    }

    return incoming.replicaId > current.replicaId
  }

  private func makeLWWPayload(_ state: LWWState) -> [String: Any] {
    return [
      "value": state.value,
      "timestamp": state.timestamp,
      "replicaId": state.replicaId,
    ]
  }

  @objc(increment:resolver:rejecter:)
  func increment(
    _ replicaId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard self.isValidReplicaId(replicaId) else {
        reject("E_INVALID_REPLICA_ID", "replicaId must be a non-empty string", nil)
        return
      }

      let current = self.state[replicaId] ?? 0
      self.state[replicaId] = current + 1
      resolve(self.totalValue())
    }
  }

  @objc(merge:resolver:rejecter:)
  func merge(
    _ remoteState: [String: NSNumber],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      for (replicaId, number) in remoteState {
        if !self.isValidReplicaId(replicaId) {
          continue
        }

        let doubleValue = number.doubleValue
        if !doubleValue.isFinite || doubleValue < 0 || doubleValue.rounded(.towardZero) != doubleValue {
          continue
        }

        let v = Int(doubleValue)
        let local = self.state[replicaId] ?? 0
        self.state[replicaId] = max(local, v)
      }

      resolve(self.totalValue())
    }
  }

  @objc(getValue:rejecter:)
  func getValue(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      resolve(self.totalValue())
    }
  }

  @objc(reset:rejecter:)
  func reset(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      self.state = [:]
      resolve(true)
    }
  }

  @objc(runDashboardComputation:resolver:rejecter:)
  func runDashboardComputation(
    _ size: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let n = validatedDashboardSize(size, rejecter: reject) else { return }

    queue.async {
      let result = self.computeDashboardComputation(size: n)
      resolve(result)
    }
  }

  @objc(runDashboardComputationProfiled:resolver:rejecter:)
  func runDashboardComputationProfiled(
    _ size: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let n = validatedDashboardSize(size, rejecter: reject) else { return }

    queue.async {
      let startedAt = DispatchTime.now().uptimeNanoseconds
      let result = self.computeDashboardComputation(size: n)
      let endedAt = DispatchTime.now().uptimeNanoseconds
      let nativeComputeTimeMs = Double(endedAt - startedAt) / 1_000_000.0

      resolve([
        "nativeComputeTimeMs": nativeComputeTimeMs,
        "checksum": result["checksum"] ?? 0,
        "average": result["average"] ?? 0.0,
        "min": result["min"] ?? 0.0,
        "max": result["max"] ?? 0.0,
        "trend": result["trend"] ?? 0.0,
      ])
    }
  }

  @objc(lwwSet:timestamp:replicaId:resolver:rejecter:)
  func lwwSet(
    _ value: String,
    timestamp: NSNumber,
    replicaId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard self.isValidReplicaId(replicaId) else {
        reject("E_INVALID_REPLICA_ID", "replicaId must be a non-empty string", nil)
        return
      }

      let ts = timestamp.doubleValue
      guard self.isValidTimestamp(ts) else {
        reject("E_INVALID_TIMESTAMP", "timestamp must be a finite number", nil)
        return
      }

      self.lwwState = LWWState(value: value, timestamp: ts, replicaId: replicaId)
      resolve(self.makeLWWPayload(self.lwwState))
    }
  }

  @objc(lwwMerge:resolver:rejecter:)
  func lwwMerge(
    _ state: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard
        let value = state["value"] as? String,
        let timestamp = state["timestamp"] as? NSNumber,
        let replicaId = state["replicaId"] as? String,
        self.isValidReplicaId(replicaId),
        self.isValidTimestamp(timestamp.doubleValue)
      else {
        reject("E_INVALID_LWW_STATE", "state must include value, timestamp, and replicaId", nil)
        return
      }

      let incoming = LWWState(
        value: value,
        timestamp: timestamp.doubleValue,
        replicaId: replicaId
      )

      if self.isIncomingLWWStateNewer(incoming, than: self.lwwState) {
        self.lwwState = incoming
      }

      resolve(self.makeLWWPayload(self.lwwState))
    }
  }

  @objc(lwwGet:rejecter:)
  func lwwGet(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      resolve(self.makeLWWPayload(self.lwwState))
    }
  }

  @objc(lwwReset:rejecter:)
  func lwwReset(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      self.lwwState = LWWState(value: "", timestamp: 0, replicaId: "")
      resolve(true)
    }
  }

  private func computeDashboardComputation(size: Int) -> [String: Any] {
    let n = max(0, size)
    if n == 0 {
      return [
        "average": 0.0,
        "min": 0.0,
        "max": 0.0,
        "trend": 0.0,
        "normalizedValues": [],
        "checksum": 0,
        "workloadSize": 0,
      ]
    }

    var telemetry = Array(repeating: 0.0, count: n)
    telemetry.withUnsafeMutableBufferPointer { buf in
      for i in 0..<n {
        buf[i] = self.generateTelemetryPoint(i: i)
      }
    }

    let smoothed = movingAverage(values: telemetry, windowSize: dashboardWindowSize)

    var minValue = Double.greatestFiniteMagnitude
    var maxValue = -Double.greatestFiniteMagnitude
    var sum = 0.0
    for v in smoothed {
      if v < minValue { minValue = v }
      if v > maxValue { maxValue = v }
      sum += v
    }
    if !minValue.isFinite { minValue = 0.0 }
    if !maxValue.isFinite { maxValue = 0.0 }
    let average = smoothed.isEmpty ? 0.0 : sum / Double(smoothed.count)

    let tailCount = min(200, smoothed.count)
    let tail = tailCount > 0 ? Array(smoothed.suffix(tailCount)) : []
    let trend = computeTrendSlope(values: tail)

    let range = maxValue - minValue
    var normalizedAll = Array(repeating: 0.0, count: smoothed.count)
    if range > 0 {
      for i in 0..<smoothed.count {
        let x = (smoothed[i] - minValue) / range
        normalizedAll[i] = clamp01(x)
      }
    }

    let normalizedSample = sampleEvenly(values: normalizedAll, sampleSize: dashboardSampleSize)
    let checksum = checksumNumberSeries(values: normalizedSample)

    return [
      "average": average,
      "min": minValue,
      "max": maxValue,
      "trend": trend,
      "normalizedValues": normalizedSample,
      "checksum": checksum,
      "workloadSize": n,
    ]
  }

  private func validatedDashboardSize(
    _ size: NSNumber,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) -> Int? {
    let n = size.intValue
    guard allowedDashboardSizes.contains(n) else {
      reject("E_INVALID_SIZE", "size must be one of 1000, 5000, 10000", nil)
      return nil
    }
    return n
  }

  private func generateTelemetryPoint(i: Int) -> Double {
    // Must match JS:
    // sin(i*0.17) + 0.55*cos(i*0.07) + ((i%97)/97)*0.15 + ((i%19)-9)*0.0025
    let a = sin(Double(i) * 0.17)
    let b = cos(Double(i) * 0.07) * 0.55
    let c = (Double(i % 97) / 97.0) * 0.15
    let d = Double((i % 19) - 9) * 0.0025
    return a + b + c + d
  }

  private func movingAverage(values: [Double], windowSize: Int) -> [Double] {
    if values.isEmpty {
      return []
    }
    let w = max(1, windowSize)
    var out = Array(repeating: 0.0, count: values.count)

    var sum = 0.0
    for i in 0..<values.count {
      sum += values[i]
      if i >= w {
        sum -= values[i - w]
      }
      let denom = (i + 1) < w ? (i + 1) : w
      out[i] = sum / Double(denom)
    }
    return out
  }

  private func computeTrendSlope(values: [Double]) -> Double {
    // Linear regression slope for x = 0..n-1 (must match JS approach).
    let n = values.count
    if n < 2 {
      return 0.0
    }

    let xMean = Double(n - 1) / 2.0
    var ySum = 0.0
    for v in values { ySum += v }
    let yMean = ySum / Double(n)

    var num = 0.0
    var den = 0.0
    for i in 0..<n {
      let dx = Double(i) - xMean
      let dy = values[i] - yMean
      num += dx * dy
      den += dx * dx
    }
    if den == 0 {
      return 0.0
    }
    return num / den
  }

  private func clamp01(_ x: Double) -> Double {
    if x <= 0 { return 0 }
    if x >= 1 { return 1 }
    return x
  }

  private func sampleEvenly(values: [Double], sampleSize: Int) -> [Double] {
    let n = values.count
    let k = max(0, sampleSize)
    if n == 0 || k == 0 {
      return []
    }
    if n <= k {
      return values
    }

    var out: [Double] = []
    out.reserveCapacity(k)
    if k == 1 {
      out.append(values[0])
      return out
    }
    for i in 0..<k {
      let t = Double(i) / Double(k - 1)
      let idx = min(n - 1, Int((t * Double(n - 1)).rounded()))
      out.append(values[idx])
    }
    return out
  }

  private func imul32(_ a: Int32, _ b: Int32) -> Int32 {
    let product = Int64(a) * Int64(b)
    let low = Int32(truncatingIfNeeded: product)
    return low
  }

  private func checksumNumberSeries(values: [Double]) -> Int {
    // Must match JS checksum logic in src/dashboard/js/dashboardComputation.ts
    // h = (imul(h, 1664525) + q + 1013904223) % 2147483647
    var h: Int32 = 1_000_003
    let mod: Int32 = 2_147_483_647

    for v in values {
      let q = Int32((v * 1_000_000.0).rounded(.towardZero))
      let mul = imul32(h, 1_664_525)
      let sum = Int64(mul) + Int64(q) + 1_013_904_223
      let m = Int32(sum % Int64(mod))
      h = m
    }

    return Int(h)
  }
}
