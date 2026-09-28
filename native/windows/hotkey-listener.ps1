# Low-level keyboard hook for the Ctrl+Win chord. Emits one JSON line per
# transition on stdout:
#   {"event":"ready"}            hook installed
#   {"event":"down"}             Ctrl+Win became active (no third key)
#   {"event":"up"}               the chord was released or cancelled
#   {"event":"escape"}           Escape while Ctrl+Win is held
#   {"event":"error","code":N}   SetWindowsHookEx failed
#
# Only key transitions are reported; all gesture timing (tap / double tap /
# hold) is decided in JS by HotkeyController. A no-op key is injected when the
# chord engages so a bare Ctrl+Win tap does not open the Start menu.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class LocalFlowHotkey {
    public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(
        int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr CallNextHookEx(
        IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    public static extern void keybd_event(
        byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern int GetMessage(
        out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG {
        public IntPtr hwnd; public uint message; public IntPtr wParam;
        public IntPtr lParam; public uint time; public int ptx; public int pty;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public uint vkCode; public uint scanCode; public uint flags;
        public uint time; public IntPtr dwExtraInfo;
    }

    const int WH_KEYBOARD_LL = 13;
    const int HC_ACTION = 0;
    const uint WM_KEYDOWN = 0x0100;
    const uint WM_KEYUP = 0x0101;
    const uint WM_SYSKEYDOWN = 0x0104;
    const uint WM_SYSKEYUP = 0x0105;
    const uint LLKHF_INJECTED = 0x10;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const byte VK_NOOP = 0xFF;

    const uint VK_LCONTROL = 0xA2;
    const uint VK_RCONTROL = 0xA3;
    const uint VK_LWIN = 0x5B;
    const uint VK_RWIN = 0x5C;
    const uint VK_ESCAPE = 0x1B;

    static IntPtr _hook = IntPtr.Zero;
    static LowLevelKeyboardProc _proc = HookCallback;
    static bool _lctrl, _rctrl, _lwin, _rwin, _chordActive, _polluted, _escapeDown;

    static bool CtrlDown { get { return _lctrl || _rctrl; } }
    static bool WinDown { get { return _lwin || _rwin; } }

    static void Emit(string ev) {
        Console.Out.WriteLine("{\"event\":\"" + ev + "\"}");
        Console.Out.Flush();
    }

    static void Mask() {
        keybd_event(VK_NOOP, 0, 0, UIntPtr.Zero);
        keybd_event(VK_NOOP, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode == HC_ACTION) {
            KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(
                lParam, typeof(KBDLLHOOKSTRUCT));
            if ((data.flags & LLKHF_INJECTED) == 0) {
                uint msg = (uint)wParam.ToInt32();
                bool isDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
                bool isUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);
                uint vk = data.vkCode;
                bool isCtrl = (vk == VK_LCONTROL || vk == VK_RCONTROL);
                bool isWin = (vk == VK_LWIN || vk == VK_RWIN);

                // Electron's bare Escape global shortcut does not match when
                // Ctrl+Win is still held for push-to-talk. Consume this chord
                // locally and report it as cancellation instead of treating
                // the key as the release that would transcribe the audio.
                if (vk == VK_ESCAPE) {
                    if (isDown && (_chordActive || _escapeDown)) {
                        if (!_escapeDown) {
                            _escapeDown = true;
                            _chordActive = false;
                            _polluted = true;
                            Emit("escape");
                        }
                        return new IntPtr(1);
                    }
                    if (isUp && _escapeDown) {
                        _escapeDown = false;
                        return new IntPtr(1);
                    }
                }

                if (isDown) {
                    if (vk == VK_LCONTROL) _lctrl = true;
                    else if (vk == VK_RCONTROL) _rctrl = true;
                    else if (vk == VK_LWIN) _lwin = true;
                    else if (vk == VK_RWIN) _rwin = true;
                    else {
                        if (_chordActive) { _chordActive = false; Emit("up"); }
                        _polluted = CtrlDown && WinDown;
                    }
                    if (!_chordActive && !_polluted && CtrlDown && WinDown
                        && (isCtrl || isWin)) {
                        _chordActive = true;
                        Mask();
                        Emit("down");
                    }
                } else if (isUp) {
                    if (vk == VK_LCONTROL) _lctrl = false;
                    else if (vk == VK_RCONTROL) _rctrl = false;
                    else if (vk == VK_LWIN) _lwin = false;
                    else if (vk == VK_RWIN) _rwin = false;
                    if (_chordActive && (!CtrlDown || !WinDown)) {
                        _chordActive = false;
                        Emit("up");
                    }
                    if (!CtrlDown && !WinDown) _polluted = false;
                }
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public static bool Install() {
        _hook = SetWindowsHookEx(
            WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
        return _hook != IntPtr.Zero;
    }

    public static int LastError() { return Marshal.GetLastWin32Error(); }

    public static void Pump() {
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
        if (_hook != IntPtr.Zero) UnhookWindowsHookEx(_hook);
    }

    public static bool SelfTest() {
        IntPtr h = SetWindowsHookEx(
            WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
        if (h == IntPtr.Zero) return false;
        UnhookWindowsHookEx(h);
        return true;
    }
}
"@

if ($env:LOCAL_FLOW_HOTKEY_SELFTEST -eq "1") {
    if ([LocalFlowHotkey]::SelfTest()) {
        [Console]::Out.WriteLine('{"event":"selftest-ok"}')
    } else {
        [Console]::Out.WriteLine(
            '{"event":"error","code":' + [LocalFlowHotkey]::LastError() + '}')
    }
    [Console]::Out.Flush()
    return
}

if ([LocalFlowHotkey]::Install()) {
    [Console]::Out.WriteLine('{"event":"ready"}')
    [Console]::Out.Flush()
    [LocalFlowHotkey]::Pump()
} else {
    [Console]::Out.WriteLine(
        '{"event":"error","code":' + [LocalFlowHotkey]::LastError() + '}')
    [Console]::Out.Flush()
}
