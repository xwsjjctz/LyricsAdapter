// Test-only AppKit inspection and control activation. Never bundled with the app.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>
NSView* Find(NSView* root, NSString* name) {
 if ([root.accessibilityIdentifier isEqualToString:name]) return root;
 for(NSView* child in root.subviews) { NSView* match=Find(child,name); if(match)return match; }
 return nil;
}
napi_value Probe(napi_env env,napi_callback_info info) {
 size_t argc=3;napi_value args[3];napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
 void* bytes=nullptr;size_t size=0;napi_get_buffer_info(env,args[0],&bytes,&size);
 void* ptr=nullptr;if(size!=sizeof(ptr))return nullptr;memcpy(&ptr,bytes,sizeof(ptr));
 NSView* content=((__bridge NSView*)ptr).window.contentView;
 if(argc>1){
 char name[128];napi_get_value_string_utf8(env,args[1],name,128,nullptr);
 NSView* view=Find(content,[NSString stringWithUTF8String:name]);
 if(argc>2 && [view isKindOfClass:NSSlider.class]) {double value=0;napi_get_value_double(env,args[2],&value);((NSSlider*)view).doubleValue=value;}
 if([view isKindOfClass:NSControl.class]) {NSControl* control=(NSControl*)view;[control sendAction:control.action to:control.target];}
 else if(view) [view mouseExited:nil];
 }
 NSMutableArray* items=[NSMutableArray array];
 NSArray* names=@[@"focus-glass-host",@"focus-glass-bar",@"focus-glass-frost",@"focus-glass-volume",@"focus-glass-play",@"focus-glass-seek",@"focus-glass-volume-slider",@"player-sliders-host",@"player-native-seek",@"player-native-volume"];
 for(NSString* name in names){NSView* v=Find(content,name);if(!v)continue;
 NSRect frame=[v convertRect:v.bounds toView:content];
 [items addObject:@{@"id":name,@"class":NSStringFromClass(v.class),@"hidden":@(v.hidden),@"alpha":@(v.alphaValue),@"x":@(frame.origin.x),@"y":@(frame.origin.y),@"width":@(frame.size.width),@"height":@(frame.size.height),@"label":v.accessibilityLabel?:@""}];}
 NSDictionary* result=@{@"windowNumber":@(content.window.windowNumber),@"items":items};
 NSData* data=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
 napi_value value;napi_create_string_utf8(env,(const char*)data.bytes,data.length,&value);return value;
}
// Real production view with an isolated window supplying deterministic cursor
// coordinates. No cursor warping or interaction with the user's menu bar.
@interface LAHoverTestWindow : NSWindow
@property NSPoint testPointer;
@end
@implementation LAHoverTestWindow
- (NSPoint)mouseLocationOutsideOfEventStream { return self.testPointer; }
@end
napi_value StatusHover(napi_env env, napi_callback_info info) {
 (void)info;
 LAHoverTestWindow* window = [[LAHoverTestWindow alloc] initWithContentRect:NSMakeRect(0,0,240,28) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
 NSView* view = [[NSClassFromString(@"LyricsStatusItemView") alloc] initWithFrame:NSMakeRect(0,0,240,28)];
 [window.contentView addSubview:view];
 window.testPointer = NSMakePoint(120,14);
 [view updateTrackingAreas]; [view mouseEntered:nil];
 id tracking = [view valueForKey:@"pointerTrackingArea"];
 BOOL stayedInside = YES;
 for (int i=0;i<100;i++) {
   [view setValue:@(i%2 == 0) forKey:@"playing"];
   [view setValue:@"歌词持续更新" forKey:@"lyricText"];
   NSEvent* click = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:NSMakePoint(80+(i%3)*40,14) modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:i clickCount:1 pressure:1];
   [view mouseDown:click]; [view setNeedsLayout:YES]; [view layoutSubtreeIfNeeded];
   [view updateTrackingAreas]; [view mouseExited:nil];
   stayedInside = stayedInside && [[view valueForKey:@"pointerInside"] boolValue];
 }
 BOOL controlsVisible = !((NSView*)[view valueForKey:@"toggleImageView"]).hidden;
 BOOL stable = tracking == [view valueForKey:@"pointerTrackingArea"];
 window.testPointer = NSMakePoint(260,14); [view mouseExited:nil];
 BOOL exited = ![[view valueForKey:@"pointerInside"] boolValue] && ((NSView*)[view valueForKey:@"toggleImageView"]).hidden;
 NSDictionary* result = @{@"stayedInside":@(stayedInside), @"trackingStable":@(stable), @"controlsVisible":@(controlsVisible), @"exited":@(exited)};
 [view removeFromSuperview];
 NSData* data=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
 napi_value value;napi_create_string_utf8(env,(const char*)data.bytes,data.length,&value);return value;
}
napi_value Init(napi_env env,napi_value exports){
 napi_value f;napi_create_function(env,"probe",NAPI_AUTO_LENGTH,Probe,nullptr,&f);napi_set_named_property(env,exports,"probe",f);
 napi_create_function(env,"statusHover",NAPI_AUTO_LENGTH,StatusHover,nullptr,&f);napi_set_named_property(env,exports,"statusHover",f);
 return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Init)
