import Foundation
import React

@objc(TurboCRDTCore)
final class TurboCRDTCore: NSObject {
  private let queue = DispatchQueue(label: "turbo.crdt.queue", qos: .userInitiated)
  private var state: [String: Int] = [:]

  private func totalValue() -> Int? {
    var total = 0
    for value in state.values {
      let result = total.addingReportingOverflow(value)
      if result.overflow {
        return nil
      }
      total = result.partialValue
    }
    return total
  }

  @objc(increment:resolver:rejecter:)
  func increment(
    _ replicaId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard !replicaId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        reject("E_INVALID_REPLICA_ID", "replicaId must be a non-empty string", nil)
        return
      }

      let current = self.state[replicaId] ?? 0
      let incremented = current.addingReportingOverflow(1)
      guard !incremented.overflow else {
        reject("E_COUNTER_OVERFLOW", "replica counter exceeds the supported Int range", nil)
        return
      }

      self.state[replicaId] = incremented.partialValue
      guard let total = self.totalValue() else {
        self.state[replicaId] = current
        reject("E_COUNTER_OVERFLOW", "G-Counter total exceeds the supported Int range", nil)
        return
      }

      resolve(total)
    }
  }

  @objc(mergeEntries:resolver:rejecter:)
  func mergeEntries(
    _ entries: [[String: Any]],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      var validatedEntries: [(replicaId: String, value: Int)] = []

      for entry in entries {
        guard
          let replicaId = entry["replicaId"] as? String,
          !replicaId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          let number = entry["value"] as? NSNumber
        else {
          reject("E_INVALID_ENTRY", "each merge entry must include replicaId and value", nil)
          return
        }

        let doubleValue = number.doubleValue
        guard
          doubleValue.isFinite,
          doubleValue >= 0,
          doubleValue.rounded(.towardZero) == doubleValue,
          doubleValue <= Double(Int.max)
        else {
          reject("E_INVALID_ENTRY_VALUE", "merge values must be finite non-negative integers", nil)
          return
        }

        validatedEntries.append((replicaId, Int(doubleValue)))
      }

      let previousState = self.state
      for entry in validatedEntries {
        self.state[entry.replicaId] = max(
          self.state[entry.replicaId] ?? 0,
          entry.value
        )
      }

      guard let total = self.totalValue() else {
        self.state = previousState
        reject("E_COUNTER_OVERFLOW", "G-Counter total exceeds the supported Int range", nil)
        return
      }

      resolve(total)
    }
  }

  @objc(getValueWithResolver:rejecter:)
  func getValue(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard let total = self.totalValue() else {
        reject("E_COUNTER_OVERFLOW", "G-Counter total exceeds the supported Int range", nil)
        return
      }

      resolve(total)
    }
  }

  @objc(resetWithResolver:rejecter:)
  func reset(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      self.state.removeAll(keepingCapacity: false)
      resolve(true)
    }
  }
}
