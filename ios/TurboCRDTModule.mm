#import "TurboCRDTModule.h"
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import "RNOffloadingBenchmark-Swift.h"

#import <React/RCTBridgeModule.h>

using namespace facebook::react;

@implementation TurboCRDTModule {
  TurboCRDTCore *_core;
}

RCT_EXPORT_MODULE(TurboCRDTModule)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    _core = [TurboCRDTCore new];
  }
  return self;
}

- (void)increment:(NSString *)replicaId
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  [_core increment:replicaId resolver:resolve rejecter:reject];
}

- (void)merge:(NSArray *)entries
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  [_core mergeEntries:entries resolver:resolve rejecter:reject];
}

- (void)getValue:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  [_core getValueWithResolver:resolve rejecter:reject];
}

- (void)reset:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  [_core resetWithResolver:resolve rejecter:reject];
}

- (std::shared_ptr<TurboModule>)getTurboModule:
    (const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeTurboCRDTModuleSpecJSI>(params);
}

@end
