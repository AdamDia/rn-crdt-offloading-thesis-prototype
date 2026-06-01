import Foundation
import React
import UIKit
import UniformTypeIdentifiers

@objc(CSVExportModule)
final class CSVExportModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  private func normalizedCSVFileName(_ fileName: String) -> String {
    let trimmed = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return "benchmark-results.csv"
    }
    if trimmed.lowercased().hasSuffix(".csv") {
      return trimmed
    }
    return "\(trimmed).csv"
  }

  private func writeCSVToTempFile(csv: String, fileName: String) throws -> URL {
    let safeName = normalizedCSVFileName(fileName)
    let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    let fileURL = tempDir.appendingPathComponent(safeName)
    try csv.write(to: fileURL, atomically: true, encoding: .utf8)
    return fileURL
  }

  private func presentShareSheet(forFileURL fileURL: URL) {
    let itemSource = CSVFileItemSource(fileURL: fileURL)
    let controller = UIActivityViewController(activityItems: [itemSource], applicationActivities: nil)

    if let popover = controller.popoverPresentationController, let root = RCTPresentedViewController() {
      popover.sourceView = root.view
      popover.sourceRect = CGRect(x: root.view.bounds.midX, y: root.view.bounds.midY, width: 0, height: 0)
      popover.permittedArrowDirections = []
    }

    RCTPresentedViewController()?.present(controller, animated: true, completion: nil)
  }

  @objc(exportCSV:fileName:resolver:rejecter:)
  func exportCSV(
    _ csv: String,
    fileName: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let fileURL = try writeCSVToTempFile(csv: csv, fileName: fileName)
      DispatchQueue.main.async {
        self.presentShareSheet(forFileURL: fileURL)
        resolve(true)
      }
    } catch {
      reject("E_CSV_EXPORT_FAILED", "Failed to export CSV: \(error.localizedDescription)", error)
    }
  }

  @objc(copyToClipboard:resolver:rejecter:)
  func copyToClipboard(
    _ csv: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      UIPasteboard.general.string = csv
      resolve(true)
    }
  }
}

private final class CSVFileItemSource: NSObject, UIActivityItemSource {
  private let fileURL: URL

  init(fileURL: URL) {
    self.fileURL = fileURL
  }

  func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
    return fileURL
  }

  func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
    return fileURL
  }

  func activityViewController(_ activityViewController: UIActivityViewController, dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?) -> String {
    if #available(iOS 14.0, *) {
      return UTType.commaSeparatedText.identifier
    }
    return "public.comma-separated-values-text"
  }
}

