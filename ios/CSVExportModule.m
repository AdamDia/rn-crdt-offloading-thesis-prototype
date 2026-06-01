#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(CSVExportModule, NSObject)

RCT_EXTERN_METHOD(
  exportCSV:(NSString *)csv
  fileName:(NSString *)fileName
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  copyToClipboard:(NSString *)csv
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)

@end

