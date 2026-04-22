// Keyboard + trackpad lock for "Cleaning Mode".
//
// macOS-only. Uses a CGEventTap at kCGHIDEventTap to consume keyboard, mouse,
// trackpad, and scroll events while locked. Unlock requires holding both
// Command keys for UNLOCK_DURATION_MS. A poll thread drives progress events
// (and triggers unlock) because the tap callback only fires when events arrive.

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicPtr, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const EVENT_LOCK_CHANGED: &str = "keyboard-lock-changed";
pub const EVENT_UNLOCK_PROGRESS: &str = "keyboard-unlock-progress";

const UNLOCK_DURATION_MS: i64 = 3_000;
const POLL_INTERVAL_MS: u64 = 50;

#[derive(Default)]
pub struct LockState {
    inner: Mutex<Option<Handle>>,
}

struct Handle {
    active: Arc<AtomicBool>,
    run_loop: Arc<AtomicPtr<std::ffi::c_void>>,
    poll_stop: Arc<AtomicBool>,
    tap_thread: Option<JoinHandle<()>>,
    poll_thread: Option<JoinHandle<()>>,
}

#[cfg(target_os = "macos")]
pub fn engage(app: AppHandle, state: &LockState) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Lock state poisoned".to_string())?;

    // Reap a previously-finished handle so we don't wedge after auto-unlock.
    if let Some(existing) = guard.as_ref() {
        if existing.active.load(Ordering::SeqCst) {
            return Err("Cleaning mode already active".into());
        }
    }
    if let Some(mut stale) = guard.take() {
        stale.poll_stop.store(true, Ordering::SeqCst);
        if let Some(t) = stale.tap_thread.take() {
            let _ = t.join();
        }
        if let Some(t) = stale.poll_thread.take() {
            let _ = t.join();
        }
    }

    let handle = mac::spawn(app)?;
    *guard = Some(handle);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn engage(_app: AppHandle, _state: &LockState) -> Result<(), String> {
    Err("Cleaning mode is only supported on macOS".into())
}

pub fn disengage(state: &LockState) {
    let handle = match state.inner.lock() {
        Ok(mut g) => g.take(),
        Err(_) => return,
    };
    if let Some(mut h) = handle {
        h.active.store(false, Ordering::SeqCst);
        h.poll_stop.store(true, Ordering::SeqCst);

        #[cfg(target_os = "macos")]
        {
            // Swap-to-null: whoever wins the swap is the sole caller that
            // stops the loop. Prevents a second call on a freed CFRunLoop
            // after the tap thread has already exited (auto-unlock path).
            let rl = h.run_loop.swap(std::ptr::null_mut(), Ordering::SeqCst);
            if !rl.is_null() {
                unsafe { mac::CFRunLoopStop(rl) };
            }
        }

        if let Some(t) = h.tap_thread.take() {
            let _ = t.join();
        }
        if let Some(t) = h.poll_thread.take() {
            let _ = t.join();
        }
    }
}

pub fn is_active(state: &LockState) -> bool {
    state
        .inner
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|h| h.active.load(Ordering::SeqCst)))
        .unwrap_or(false)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;

    // CGEventType
    const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
    const K_CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
    const K_CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
    const K_CG_EVENT_MOUSE_MOVED: u32 = 5;
    const K_CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;
    const K_CG_EVENT_RIGHT_MOUSE_DRAGGED: u32 = 7;
    const K_CG_EVENT_KEY_DOWN: u32 = 10;
    const K_CG_EVENT_KEY_UP: u32 = 11;
    const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const K_CG_EVENT_SCROLL_WHEEL: u32 = 22;
    const K_CG_EVENT_OTHER_MOUSE_DOWN: u32 = 25;
    const K_CG_EVENT_OTHER_MOUSE_UP: u32 = 26;
    const K_CG_EVENT_OTHER_MOUSE_DRAGGED: u32 = 27;
    const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

    // CGEventTapLocation / Placement / Options
    const K_CG_HID_EVENT_TAP: u32 = 0;
    const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
    const K_CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;

    // Device-dependent modifier flag bits (NSEvent/IOHID). Stable for decades.
    const NX_DEVICE_L_CMD_MASK: u64 = 0x0000_0008;
    const NX_DEVICE_R_CMD_MASK: u64 = 0x0000_0010;

    type CFTypeRef = *const c_void;
    type CFMachPortRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CGEventRef = *mut c_void;
    type CGEventTapProxy = *mut c_void;

    type CGEventTapCallBack = unsafe extern "C" fn(
        proxy: CGEventTapProxy,
        event_type: u32,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: u64,
            callback: CGEventTapCallBack,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CGEventGetFlags(event: CGEventRef) -> u64;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFMachPortCreateRunLoopSource(
            alloc: CFTypeRef,
            port: CFMachPortRef,
            order: isize,
        ) -> CFRunLoopSourceRef;
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(rl: CFRunLoopRef, src: CFRunLoopSourceRef, mode: CFStringRef);
        fn CFRunLoopRun();
        pub fn CFRunLoopStop(rl: CFRunLoopRef);
        fn CFRelease(cf: CFTypeRef);
        static kCFRunLoopCommonModes: CFStringRef;
    }

    struct TapContext {
        active: Arc<AtomicBool>,
        both_since_ms: Arc<AtomicI64>,
        tap_port: AtomicPtr<c_void>,
    }

    // Safety: context is heap-allocated and lives until the tap thread exits.
    unsafe extern "C" fn tap_callback(
        _proxy: CGEventTapProxy,
        event_type: u32,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef {
        let ctx = &*(user_info as *const TapContext);

        // Re-enable the tap if macOS disabled it (common after timeouts).
        if event_type == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT
            || event_type == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
        {
            let port = ctx.tap_port.load(Ordering::SeqCst);
            if !port.is_null() {
                CGEventTapEnable(port, true);
            }
            return event;
        }

        if !ctx.active.load(Ordering::SeqCst) {
            return event;
        }

        // Read device-specific Cmd bits from the event's modifier flags.
        let flags = CGEventGetFlags(event);
        let lcmd = (flags & NX_DEVICE_L_CMD_MASK) != 0;
        let rcmd = (flags & NX_DEVICE_R_CMD_MASK) != 0;

        if lcmd && rcmd {
            // Only set the start time if not already tracking.
            let _ = ctx.both_since_ms.compare_exchange(
                0,
                super::now_millis(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
        } else {
            ctx.both_since_ms.store(0, Ordering::SeqCst);
        }

        // Consume all input events while locked.
        match event_type {
            K_CG_EVENT_KEY_DOWN
            | K_CG_EVENT_KEY_UP
            | K_CG_EVENT_FLAGS_CHANGED
            | K_CG_EVENT_LEFT_MOUSE_DOWN
            | K_CG_EVENT_LEFT_MOUSE_UP
            | K_CG_EVENT_RIGHT_MOUSE_DOWN
            | K_CG_EVENT_RIGHT_MOUSE_UP
            | K_CG_EVENT_OTHER_MOUSE_DOWN
            | K_CG_EVENT_OTHER_MOUSE_UP
            | K_CG_EVENT_MOUSE_MOVED
            | K_CG_EVENT_LEFT_MOUSE_DRAGGED
            | K_CG_EVENT_RIGHT_MOUSE_DRAGGED
            | K_CG_EVENT_OTHER_MOUSE_DRAGGED
            | K_CG_EVENT_SCROLL_WHEEL => ptr::null_mut(),
            _ => event,
        }
    }

    const INPUT_EVENT_MASK: u64 = (1 << K_CG_EVENT_KEY_DOWN)
        | (1 << K_CG_EVENT_KEY_UP)
        | (1 << K_CG_EVENT_FLAGS_CHANGED)
        | (1 << K_CG_EVENT_LEFT_MOUSE_DOWN)
        | (1 << K_CG_EVENT_LEFT_MOUSE_UP)
        | (1 << K_CG_EVENT_RIGHT_MOUSE_DOWN)
        | (1 << K_CG_EVENT_RIGHT_MOUSE_UP)
        | (1 << K_CG_EVENT_OTHER_MOUSE_DOWN)
        | (1 << K_CG_EVENT_OTHER_MOUSE_UP)
        | (1 << K_CG_EVENT_MOUSE_MOVED)
        | (1 << K_CG_EVENT_LEFT_MOUSE_DRAGGED)
        | (1 << K_CG_EVENT_RIGHT_MOUSE_DRAGGED)
        | (1 << K_CG_EVENT_OTHER_MOUSE_DRAGGED)
        | (1 << K_CG_EVENT_SCROLL_WHEEL);

    pub(super) fn spawn(app: AppHandle) -> Result<Handle, String> {
        let active = Arc::new(AtomicBool::new(true));
        let both_since_ms = Arc::new(AtomicI64::new(0));
        let run_loop = Arc::new(AtomicPtr::<c_void>::new(ptr::null_mut()));
        let poll_stop = Arc::new(AtomicBool::new(false));

        // Channel to surface tap-creation failure from the worker thread.
        let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        let tap_active = active.clone();
        let tap_both = both_since_ms.clone();
        let tap_run_loop = run_loop.clone();

        let tap_thread = std::thread::Builder::new()
            .name("keyboard-lock-tap".into())
            .spawn(move || {
                // Context is intentionally leaked for the tap's lifetime;
                // dropped explicitly at the end of this thread.
                let ctx = Box::new(TapContext {
                    active: tap_active,
                    both_since_ms: tap_both,
                    tap_port: AtomicPtr::new(ptr::null_mut()),
                });
                let ctx_ptr = Box::into_raw(ctx);

                unsafe {
                    let tap = CGEventTapCreate(
                        K_CG_HID_EVENT_TAP,
                        K_CG_HEAD_INSERT_EVENT_TAP,
                        K_CG_EVENT_TAP_OPTION_DEFAULT,
                        INPUT_EVENT_MASK,
                        tap_callback,
                        ctx_ptr as *mut c_void,
                    );

                    if tap.is_null() {
                        let _ = init_tx
                            .send(Err("Failed to create CGEventTap (accessibility?)".into()));
                        drop(Box::from_raw(ctx_ptr));
                        return;
                    }

                    (*ctx_ptr).tap_port.store(tap, Ordering::SeqCst);

                    let source = CFMachPortCreateRunLoopSource(ptr::null(), tap, 0);
                    if source.is_null() {
                        CFRelease(tap as CFTypeRef);
                        let _ = init_tx.send(Err("Failed to create run loop source".into()));
                        drop(Box::from_raw(ctx_ptr));
                        return;
                    }

                    let rl = CFRunLoopGetCurrent();
                    tap_run_loop.store(rl, Ordering::SeqCst);
                    CFRunLoopAddSource(rl, source, kCFRunLoopCommonModes);
                    CGEventTapEnable(tap, true);

                    let _ = init_tx.send(Ok(()));

                    CFRunLoopRun();

                    // Cleanup after the run loop stops.
                    CGEventTapEnable(tap, false);
                    CFRelease(source as CFTypeRef);
                    CFRelease(tap as CFTypeRef);
                    drop(Box::from_raw(ctx_ptr));
                }
            })
            .map_err(|e| format!("Failed to spawn tap thread: {e}"))?;

        // Wait up to 2s for tap creation to succeed.
        match init_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = tap_thread.join();
                return Err(e);
            }
            Err(_) => {
                return Err("Timed out starting keyboard tap".into());
            }
        }

        let poll_active = active.clone();
        let poll_both = both_since_ms.clone();
        let poll_run_loop = run_loop.clone();
        let poll_stop_inner = poll_stop.clone();
        let poll_app = app.clone();

        let poll_thread = std::thread::Builder::new()
            .name("keyboard-lock-poll".into())
            .spawn(move || {
                let _ = poll_app.emit(EVENT_LOCK_CHANGED, true);
                let _ = poll_app.emit(EVENT_UNLOCK_PROGRESS, 0_u32);

                let mut last_progress: i32 = -1;

                loop {
                    if poll_stop_inner.load(Ordering::SeqCst) {
                        break;
                    }
                    if !poll_active.load(Ordering::SeqCst) {
                        break;
                    }

                    let started = poll_both.load(Ordering::SeqCst);
                    let progress = if started == 0 {
                        0
                    } else {
                        let elapsed = super::now_millis() - started;
                        ((elapsed * 100) / UNLOCK_DURATION_MS).clamp(0, 100) as i32
                    };

                    if progress != last_progress {
                        let _ = poll_app.emit(EVENT_UNLOCK_PROGRESS, progress as u32);
                        last_progress = progress;
                    }

                    if progress >= 100 {
                        poll_active.store(false, Ordering::SeqCst);
                        let rl = poll_run_loop.swap(ptr::null_mut(), Ordering::SeqCst);
                        if !rl.is_null() {
                            unsafe { CFRunLoopStop(rl) };
                        }
                        break;
                    }

                    std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
                }

                let _ = poll_app.emit(EVENT_UNLOCK_PROGRESS, 0_u32);
                let _ = poll_app.emit(EVENT_LOCK_CHANGED, false);
            })
            .map_err(|e| format!("Failed to spawn poll thread: {e}"))?;

        Ok(Handle {
            active,
            run_loop,
            poll_stop,
            tap_thread: Some(tap_thread),
            poll_thread: Some(poll_thread),
        })
    }
}
