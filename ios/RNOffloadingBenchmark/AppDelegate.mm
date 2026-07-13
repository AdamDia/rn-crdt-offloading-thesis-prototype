#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@interface RNReactNativeDelegate : RCTDefaultReactNativeFactoryDelegate
@end

@implementation RNReactNativeDelegate

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  RCTBundleURLProvider *provider = [RCTBundleURLProvider sharedSettings];
  NSURL *url = [provider jsBundleURLForBundleRoot:@"index"
                               fallbackURLProvider:^NSURL *{
                                 return [NSURL URLWithString:@"http://localhost:8081/index.bundle?platform=ios&dev=true&minify=false"];
                               }];
  if (url != nil) {
    return url;
  }

  provider.jsLocation = @"localhost";
  return [provider jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  RNReactNativeDelegate *delegate = [RNReactNativeDelegate new];
  delegate.dependencyProvider = [RCTAppDependencyProvider new];
  self.reactNativeDelegate = delegate;
  self.reactNativeFactory = [[RCTReactNativeFactory alloc] initWithDelegate:delegate];
  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];

  [self.reactNativeFactory startReactNativeWithModuleName:@"RNOffloadingBenchmark"
                                                 inWindow:self.window
                                        initialProperties:@{}
                                            launchOptions:launchOptions];
  return YES;
}

@end
