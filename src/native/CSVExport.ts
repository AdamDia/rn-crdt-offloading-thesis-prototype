import {NativeModules, Platform} from 'react-native';

type CSVExportModuleType = {
  exportCSV(csv: string, fileName: string): Promise<boolean>;
  copyToClipboard(csv: string): Promise<boolean>;
};

const NativeCSVExportModule = NativeModules.CSVExportModule as
  | CSVExportModuleType
  | undefined;

function unavailableError(): Error {
  return new Error(
    'CSVExportModule is unavailable. Rebuild the iOS app, or use Copy CSV.',
  );
}

export const CSVExport = {
  async exportCSV(csv: string, fileName = 'benchmark-results.csv') {
    if (Platform.OS !== 'ios' || !NativeCSVExportModule?.exportCSV) {
      throw unavailableError();
    }
    return NativeCSVExportModule.exportCSV(csv, fileName);
  },
  async copyToClipboard(csv: string) {
    if (Platform.OS !== 'ios' || !NativeCSVExportModule?.copyToClipboard) {
      throw unavailableError();
    }
    return NativeCSVExportModule.copyToClipboard(csv);
  },
};
