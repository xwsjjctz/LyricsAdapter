import {afterEach, describe, expect, it, vi} from 'vitest';
import {createElement, useRef} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {act} from '@testing-library/react';
import {FOCUS_CONTROLS_IDLE_MS, FocusControlsIdle} from '@/components/focus-mode/focusControlsIdle';
import {useFocusControlsIdle} from '@/components/focus-mode/useFocusControlsIdle';

let root: Root | undefined;
afterEach(() => {if(root) act(() => root!.unmount()); root = undefined; vi.useRealTimers(); document.body.replaceChildren();});

describe('Focus activity clock', () => {
  it('hides after exactly one idle second, matching landscape, and wakes on activity', () => {
    vi.useFakeTimers(); const publish=vi.fn();const clock=new FocusControlsIdle(publish);clock.activate(true);
    vi.advanceTimersByTime(999);expect(clock.visible).toBe(true);
    vi.advanceTimersByTime(1);expect(clock.visible).toBe(false);
    clock.activity();expect(clock.visible).toBe(true);expect(publish.mock.calls).toEqual([[false],[true]]);clock.dispose();
  });
  it('restarts the deadline only from activity', () => {
    vi.useFakeTimers();const clock=new FocusControlsIdle(vi.fn());clock.activate(true);
    vi.advanceTimersByTime(700);clock.activity();vi.advanceTimersByTime(999);expect(clock.visible).toBe(true);
    vi.advanceTimersByTime(1);expect(clock.visible).toBe(false);clock.dispose();
  });
  it('keeps all held pointers protected, including native continuous actions', () => {
    vi.useFakeTimers();const clock=new FocusControlsIdle(vi.fn());clock.activate(true);clock.hold('native');clock.hold('pointer:1');
    vi.advanceTimersByTime(20000);clock.activity();clock.release('native');vi.advanceTimersByTime(20000);expect(clock.visible).toBe(true);
    clock.release('pointer:1');vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS);expect(clock.visible).toBe(false);clock.dispose();
  });
  it('protects keyboard or screen reader focus until it leaves the controls', () => {
    vi.useFakeTimers();const clock=new FocusControlsIdle(vi.fn());clock.activate(true);clock.protectFocus(true);
    vi.advanceTimersByTime(20000);expect(clock.visible).toBe(true);clock.protectFocus(false);vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS);expect(clock.visible).toBe(false);clock.dispose();
  });
  it('clears the timer and held state on exit, then starts a new deadline on reentry', () => {
    vi.useFakeTimers();const publish=vi.fn();const clock=new FocusControlsIdle(publish);clock.activate(true);clock.hold('native');clock.activate(false);
    clock.hold('late-native-event');vi.advanceTimersByTime(20000);expect(publish).not.toHaveBeenCalled();clock.activate(true);
    vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS);expect(clock.visible).toBe(false);clock.dispose();expect(vi.getTimerCount()).toBe(0);
  });
});

function mount(onSeek:()=>void, updates=0) {
  function Fixture({ticks}:{ticks:number}) {
    const overlay=useRef<HTMLDivElement>(null);const idle=useFocusControlsIdle(true,true,overlay);
    return createElement('div',{ref:overlay,onPointerDownCapture:idle.pointerDown,onPointerMoveCapture:idle.pointerMove,onClickCapture:idle.click,onKeyDownCapture:idle.keyboardActivity,'data-shown':String(idle.shown)},
      createElement('button',{'data-lyric':true,onClick:onSeek},'Lyric'),
      createElement('div',{'data-focus-controls':true},createElement('button',{'data-control':true},String(ticks))));
  }
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const div=document.createElement('div');document.body.append(div);root=createRoot(div);
  act(()=>root!.render(createElement(Fixture,{ticks:updates})));
  const controls=div.querySelector<HTMLElement>('[data-focus-controls]')!;
  vi.spyOn(controls,'getBoundingClientRect').mockReturnValue(new DOMRect(20,600,400,200));
  return {div,rerender:(ticks:number)=>act(()=>root!.render(createElement(Fixture,{ticks})))};
}
function pointer(target:Element,type:string,id=1,inControls=!!target.closest('[data-focus-controls]')){
  const event=new Event(type,{bubbles:true});
  Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:type==='pointermove'?'mouse':'touch'},clientX:{value:50},clientY:{value:inControls?650:200}});
  act(()=>{target.dispatchEvent(event);});
}
describe('Focus page event guard',()=>{
  it('does not extend idle time during repeated playback renders',()=>{
    vi.useFakeTimers();const fixture=mount(vi.fn());for(let i=0;i<10;i++){act(()=>vi.advanceTimersByTime(100));fixture.rerender(i);}
    expect(fixture.div.firstElementChild!.getAttribute('data-shown')).toBe('false');
  });
  it('consumes a hidden-controls tap including AMLL detail-zero click, then permits a lyric seek outside the controls',()=>{
    vi.useFakeTimers();const seek=vi.fn();const fixture=mount(seek);act(()=>vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS));const lyric=fixture.div.querySelector<HTMLButtonElement>('[data-lyric]')!;
    pointer(lyric,'pointerdown',1,true);pointer(lyric,'pointerup',1,true);act(()=>lyric.click());expect(seek).not.toHaveBeenCalled();
    expect(fixture.div.firstElementChild!.getAttribute('data-shown')).toBe('true');pointer(lyric,'pointerdown');pointer(lyric,'pointerup');act(()=>lyric.click());expect(seek).toHaveBeenCalledTimes(1);
  });
  it('protects DOM control focus and starts idle when focus moves outside it',async()=>{
    vi.useFakeTimers();const fixture=mount(vi.fn());const control=fixture.div.querySelector<HTMLButtonElement>('[data-control]')!;
    act(()=>control.focus());act(()=>vi.advanceTimersByTime(10000));expect(fixture.div.firstElementChild!.getAttribute('data-shown')).toBe('true');
    await act(async()=>{control.blur();await Promise.resolve();});act(()=>vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS));expect(fixture.div.firstElementChild!.getAttribute('data-shown')).toBe('false');
  });
  it('keeps a hidden-controls multi-pointer gesture wake-only until all fingers have finished',()=>{
    vi.useFakeTimers();const seek=vi.fn();const fixture=mount(seek);act(()=>vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS));const lyric=fixture.div.querySelector<HTMLButtonElement>('[data-lyric]')!;
    pointer(lyric,'pointerdown',1,true);pointer(lyric,'pointerdown',2,true);pointer(lyric,'pointerup',1,true);act(()=>lyric.click());
    pointer(lyric,'pointerup',2,true);act(()=>lyric.click());expect(seek).not.toHaveBeenCalled();
    pointer(lyric,'pointerdown',3);pointer(lyric,'pointerup',3);act(()=>lyric.click());expect(seek).toHaveBeenCalledTimes(1);
  });
  it('does not retain a wake-only click token from Tab navigation',()=>{
    vi.useFakeTimers();const seek=vi.fn();const fixture=mount(seek);act(()=>vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS));const lyric=fixture.div.querySelector<HTMLButtonElement>('[data-lyric]')!;
    act(()=>lyric.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})));act(()=>lyric.click());expect(seek).toHaveBeenCalledTimes(1);
  });
  it('lets touch-induced control focus expire even if focusin arrives after pointerup',()=>{
    vi.useFakeTimers();const fixture=mount(vi.fn());const control=fixture.div.querySelector<HTMLButtonElement>('[data-control]')!;
    pointer(control,'pointerdown');pointer(control,'pointerup');act(()=>control.focus());act(()=>vi.advanceTimersByTime(FOCUS_CONTROLS_IDLE_MS));
    expect(fixture.div.firstElementChild!.getAttribute('data-shown')).toBe('false');
  });
  it('protects a touch-focused control when subsequent keys switch to keyboard interaction',()=>{
    vi.useFakeTimers();const fixture=mount(vi.fn());const control=fixture.div.querySelector<HTMLButtonElement>('[data-control]')!;
    pointer(control,'pointerdown');pointer(control,'pointerup');act(()=>control.focus());
    act(()=>control.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));act(()=>vi.advanceTimersByTime(10000));
    expect(fixture.div.firstElementChild!.getAttribute('data-shown')).toBe('true');
  });
});
