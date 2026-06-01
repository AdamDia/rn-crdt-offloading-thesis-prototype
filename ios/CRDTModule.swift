import Foundation
import React

@objc(CRDTModule)
final class CRDTModule: NSObject {
  private let queue = DispatchQueue(label: "crdt.queue", qos: .userInitiated)
  private var state: [String: Int] = [:]

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
}
