export const FOCUS_CONTROLS_IDLE_MS = 8_000;

/** A presentation timer: playback updates never count as user activity. */
export class FocusControlsIdle {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private shown = true;
  private focused = false;
  private holds = new Set<string>();
  constructor(private publish: (visible: boolean) => void) {}
  get visible() { return this.shown; }
  private clear() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private show(value: boolean) { if (value !== this.shown) { this.shown = value; this.publish(value); } }
  private schedule() {
    this.clear();
    if (!this.active || this.focused || this.holds.size) return;
    this.timer = setTimeout(() => { this.timer = null; this.show(false); }, FOCUS_CONTROLS_IDLE_MS);
  }
  activate(value: boolean) {
    this.active = value; this.clear();
    if (value) { this.show(true); this.schedule(); }
    else { this.holds.clear(); this.focused = false; }
  }
  activity() { if (this.active) { this.show(true); this.schedule(); } }
  hold(key: string, wake = true) {
    if (!this.active) return;
    this.holds.add(key); this.clear();
    if (wake && this.active) this.show(true);
  }
  release(key: string) { if (this.holds.delete(key)) this.schedule(); }
  protectFocus(value: boolean) {
    this.focused = value;
    if (value) this.activity(); else this.schedule();
  }
  dispose() { this.activate(false); }
}
