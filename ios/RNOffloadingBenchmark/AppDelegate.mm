#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"RNOffloadingBenchmark";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  // In some cases the simulator can end up with an empty/invalid packager host setting,
  // causing `jsBundleURLForBundleRoot` to return nil and the app to crash with
  // "No bundle URL present". Provide a robust localhost fallback for development.
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
