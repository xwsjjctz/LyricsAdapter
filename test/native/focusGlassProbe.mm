// Test-only AppKit inspection and control activation. Never bundled with the app.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>
NSView* Find(NSView* root, NSString* name) {
 if ([root.accessibilityIdentifier isEqualToString:name]) return root;
 for(NSView* child in root.subviews) { NSView* match=Find(child,name); if(match)return match; }
 return nil;
}
void PostMouse(NSWindow* window, NSEventType type, NSPoint point) {
 [NSApp postEvent:[NSEvent mouseEventWithType:type location:point modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1] atStart:NO];
}
napi_value Probe(napi_env env,napi_callback_info info) {
 size_t argc=3;napi_value args[3];napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
 void* bytes=nullptr;size_t size=0;napi_get_buffer_info(env,args[0],&bytes,&size);
 void* ptr=nullptr;if(size!=sizeof(ptr))return nullptr;memcpy(&ptr,bytes,sizeof(ptr));
 NSView* content=((__bridge NSView*)ptr).window.contentView;
 if(argc>1){
 char name[128];napi_get_value_string_utf8(env,args[1],name,128,nullptr);
 NSString* actionName=[NSString stringWithUTF8String:name];BOOL hover=[actionName hasSuffix:@":hover"];
 BOOL click=[actionName hasSuffix:@":click"]; BOOL drag=[actionName hasSuffix:@":drag-outside"]; BOOL exit=[actionName hasSuffix:@":exit"];
 if ([actionName hasPrefix:@"@key:"]) {
   unsigned short key=(unsigned short)[[actionName substringFromIndex:5] intValue];
   unichar character=key==53?0x1b:key==126?NSUpArrowFunctionKey:key==125?NSDownArrowFunctionKey:0;
   NSString* characters=[NSString stringWithCharacters:&character length:1];
   [NSApp postEvent:[NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:content.window.windowNumber context:nil characters:characters charactersIgnoringModifiers:characters isARepeat:NO keyCode:key] atStart:NO];
 }
 if(hover)actionName=[actionName substringToIndex:actionName.length-6];
 if(click)actionName=[actionName substringToIndex:actionName.length-6];
 if(exit)actionName=[actionName substringToIndex:actionName.length-5];
 if(drag)actionName=[actionName substringToIndex:actionName.length-13];
 NSView* view=Find(content,actionName);
 if(argc>2 && [view isKindOfClass:NSSlider.class]) {double value=0;napi_get_value_double(env,args[2],&value);((NSSlider*)view).doubleValue=value;}
 if(click&&view) {
   NSPoint point=[view convertPoint:NSMakePoint(NSMidX(view.bounds),NSMidY(view.bounds)) toView:nil];
   PostMouse(content.window,NSEventTypeLeftMouseDown,point); PostMouse(content.window,NSEventTypeLeftMouseUp,point);
 }
 else if(drag&&[view isKindOfClass:NSSlider.class]) {
   NSRect knob=[(NSSliderCell*)((NSSlider*)view).cell knobRectFlipped:view.isFlipped];
   NSPoint start=[view convertPoint:NSMakePoint(NSMidX(knob),NSMidY(knob)) toView:nil];
   NSPoint end=[view convertPoint:NSMakePoint(NSMaxX(view.bounds)+60,view.bounds.size.height*0.7) toView:nil];
   PostMouse(content.window,NSEventTypeLeftMouseDown,start); PostMouse(content.window,NSEventTypeLeftMouseDragged,end); PostMouse(content.window,NSEventTypeLeftMouseUp,end);
 }
 else if(exit&&[actionName hasPrefix:@"player-controlbar-volume"]) [view mouseExited:nil];
 else if(hover&&[actionName hasPrefix:@"player-controlbar-volume"]) [view mouseEntered:nil];
 else if(hover&&view) PostMouse(content.window,NSEventTypeMouseMoved,[view convertPoint:NSMakePoint(NSMidX(view.bounds),NSMidY(view.bounds)) toView:nil]);
 else if([view isKindOfClass:NSControl.class]) {NSControl* control=(NSControl*)view;[control sendAction:control.action to:control.target];}
 else if(view && ([actionName isEqualToString:@"focus-glass-host"] || [actionName isEqualToString:@"player-controlbar-volume-disclosure"] || [actionName isEqualToString:@"player-controlbar-volume-button"])) [view mouseExited:nil];
 else if(view) PostMouse(content.window,NSEventTypeMouseMoved,NSMakePoint(0,0));
 }
 NSMutableArray* items=[NSMutableArray array];
 NSArray* names=@[@"focus-glass-host",@"focus-glass-bar",@"focus-glass-highlight",@"focus-glass-frost",@"focus-glass-volume",@"focus-glass-play",@"focus-glass-seek",@"focus-glass-volume-slider",@"player-controlbar-host",@"player-controlbar-glass",@"player-controlbar-highlight",@"player-controlbar-slider-glass",@"player-controlbar-volume-disclosure",@"player-controlbar-volume-button",@"player-controlbar-volume-value",@"player-controlbar-title",@"player-controlbar-artist",@"player-controlbar-focus",@"player-controlbar-previous",@"player-controlbar-play",@"player-controlbar-next",@"player-controlbar-seek",@"player-controlbar-mode",@"player-controlbar-volume",@"player-controlbar-mute"];
 for(NSString* name in names){NSView* v=Find(content,name);if(!v)continue;
 NSRect frame=[v convertRect:v.bounds toView:content];
 NSString* label=[v isKindOfClass:NSTextField.class]?((NSTextField*)v).stringValue:v.accessibilityLabel;
 NSString* appearance=[v.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua,NSAppearanceNameDarkAqua]];
 [items addObject:@{@"id":name,@"class":NSStringFromClass(v.class),@"hidden":@(v.hidden),@"focused":@(v.window.firstResponder==v),@"alpha":@(v.alphaValue),@"x":@(frame.origin.x),@"y":@(frame.origin.y),@"width":@(frame.size.width),@"height":@(frame.size.height),@"label":label?:@"",@"appearance":appearance?:@""}];}
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
