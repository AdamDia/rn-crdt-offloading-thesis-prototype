#import <UIKit/UIKit.h>
#import <React-RCTAppDelegate/RCTReactNativeFactory.h>

@interface AppDelegate : UIResponder <UIApplicationDelegate>

@property (nonatomic, strong) UIWindow *window;
@property (nonatomic, strong) id<RCTReactNativeFactoryDelegate> reactNativeDelegate;
@property (nonatomic, strong) RCTReactNativeFactory *reactNativeFactory;

@end
