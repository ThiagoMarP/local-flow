$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class LocalFlowWindows {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(
        IntPtr hWnd,
        out uint processId
    );

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(
        IntPtr hWnd,
        StringBuilder text,
        int count
    );

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(
        IntPtr hWnd,
        bool altTab
    );

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(
        uint sourceThread,
        uint targetThread,
        bool attach
    );

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(
        EnumWindowsProc callback,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    public static extern void keybd_event(
        byte virtualKey,
        byte scanCode,
        uint flags,
        UIntPtr extraInfo
    );

    [DllImport("user32.dll")]
    public static extern bool GetGUIThreadInfo(
        uint threadId,
        ref GUITHREADINFO info
    );

    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO {
        public int cbSize;
        public int flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    private const int SW_RESTORE = 9;
    private const uint GA_ROOT = 2;
    private const byte VK_CONTROL = 0x11;
    private const byte VK_SHIFT = 0x10;
    private const byte VK_MENU = 0x12;
    private const byte VK_LWIN = 0x5B;
    private const byte VK_RWIN = 0x5C;
    private const byte VK_SPACE = 0x20;
    private const byte VK_V = 0x56;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const int GUI_MENU_FLAGS = 0x1C;

    public static string GetTitle(IntPtr hWnd) {
        var builder = new StringBuilder(1024);
        GetWindowText(hWnd, builder, builder.Capacity);
        return builder.ToString();
    }

    public static uint GetProcessId(IntPtr hWnd) {
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        return processId;
    }

    public static IntPtr FindWindowByTitle(string fragment) {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) return true;
            string title = GetTitle(hWnd);
            if (
                !String.IsNullOrEmpty(title) &&
                title.IndexOf(fragment, StringComparison.OrdinalIgnoreCase) >= 0
            ) {
                result = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static bool FocusWindow(IntPtr target) {
        if (target == IntPtr.Zero || !IsWindow(target)) return false;
        // The capture step normally leaves the target active. Avoid touching
        // its z-order or input focus in that common case.
        if (GetForegroundWindow() == target) return true;

        IntPtr foreground = GetForegroundWindow();
        uint foregroundPid;
        uint targetPid;
        uint foregroundThread = GetWindowThreadProcessId(
            foreground,
            out foregroundPid
        );
        uint targetThread = GetWindowThreadProcessId(target, out targetPid);
        uint currentThread = GetCurrentThreadId();

        bool attachedForeground = false;
        bool attachedTarget = false;
        try {
            if (foregroundThread != 0 && foregroundThread != currentThread) {
                attachedForeground = AttachThreadInput(
                    currentThread,
                    foregroundThread,
                    true
                );
            }
            if (targetThread != 0 && targetThread != currentThread) {
                attachedTarget = AttachThreadInput(
                    currentThread,
                    targetThread,
                    true
                );
            }
            // Only un-minimize a minimized target. Calling SW_RESTORE on a
            // maximized/fullscreen window would also un-maximize it, yanking it
            // out of fullscreen the moment we paste into it.
            if (IsIconic(target)) {
                ShowWindowAsync(target, SW_RESTORE);
            }
            SetForegroundWindow(target);
            if (GetForegroundWindow() != target) {
                // FALSE avoids an Alt/Ctrl+Tab transition, which can leave
                // the destination application's menu active.
                SwitchToThisWindow(target, false);
            }
        } finally {
            if (attachedTarget) {
                AttachThreadInput(currentThread, targetThread, false);
            }
            if (attachedForeground) {
                AttachThreadInput(currentThread, foregroundThread, false);
            }
        }
        for (int attempt = 0; attempt < 20; attempt++) {
            if (GetForegroundWindow() == target) return true;
            System.Threading.Thread.Sleep(10);
        }
        return false;
    }

    private static bool HasActiveModifier() {
        return (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 ||
            (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0 ||
            (GetAsyncKeyState(VK_MENU) & 0x8000) != 0 ||
            (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 ||
            (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;
    }

    private static bool WaitForModifiersReleased() {
        for (int attempt = 0; attempt < 25; attempt++) {
            if (!HasActiveModifier()) return true;
            System.Threading.Thread.Sleep(20);
        }
        return !HasActiveModifier();
    }

    public static IntPtr GetFocusedChild(IntPtr target) {
        uint processId;
        uint threadId = GetWindowThreadProcessId(target, out processId);
        var info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (threadId == 0 || !GetGUIThreadInfo(threadId, ref info)) {
            return IntPtr.Zero;
        }
        if ((info.flags & GUI_MENU_FLAGS) != 0 ||
            info.hwndMenuOwner != IntPtr.Zero) {
            return IntPtr.Zero;
        }
        IntPtr focus = info.hwndFocus;
        return focus != IntPtr.Zero &&
            GetAncestor(focus, GA_ROOT) == target
            ? focus : IntPtr.Zero;
    }

    private static bool RestoreFocusedChild(IntPtr target, IntPtr child) {
        if (child == IntPtr.Zero || !IsWindow(child) ||
            GetAncestor(child, GA_ROOT) != target) {
            return false;
        }
        if (GetFocusedChild(target) == child) return true;
        // A root HWND can own keyboard focus for browser DOM editors. Do not
        // call SetFocus on it after focus changes, because that can discard
        // the browser's selected text field.
        if (child == target) return false;

        uint processId;
        uint focusThread = GetWindowThreadProcessId(child, out processId);
        uint currentThread = GetCurrentThreadId();
        bool attached = false;
        try {
            if (focusThread != 0 && focusThread != currentThread) {
                attached = AttachThreadInput(currentThread, focusThread, true);
                if (!attached) return false;
            }
            SetFocus(child);
        } finally {
            if (attached) AttachThreadInput(currentThread, focusThread, false);
        }
        return GetFocusedChild(target) == child;
    }

    public static void SendPaste() {
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    public static string PasteToWindow(IntPtr target, IntPtr focusedChild) {
        if (target == IntPtr.Zero || !IsWindow(target)) {
            return "target-unavailable";
        }
        if (!WaitForModifiersReleased()) return "modifiers-active";
        if (!FocusWindow(target)) return "foreground-denied";
        System.Threading.Thread.Sleep(60);
        if (GetForegroundWindow() != target) return "target-focus-lost";
        if (!RestoreFocusedChild(target, focusedChild)) {
            return "target-focus-lost";
        }
        if (!WaitForModifiersReleased() || GetForegroundWindow() != target ||
            GetFocusedChild(target) != focusedChild) {
            return "target-focus-lost";
        }
        SendPaste();
        System.Threading.Thread.Sleep(30);
        return GetForegroundWindow() == target &&
            GetFocusedChild(target) == focusedChild &&
            !HasActiveModifier()
            ? "send-input" : "target-focus-lost";
    }

    public static void SendToggleShortcut() {
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_SHIFT, 0, 0, UIntPtr.Zero);
        keybd_event(VK_SPACE, 0, 0, UIntPtr.Zero);
        keybd_event(VK_SPACE, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
"@

function Get-WindowInfo([IntPtr]$Handle) {
    if ($Handle -eq [IntPtr]::Zero -or -not [LocalFlowWindows]::IsWindow($Handle)) {
        return $null
    }

    $processId = [LocalFlowWindows]::GetProcessId($Handle)
    $processName = ""
    try {
        $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    } catch {
        $processName = ""
    }

    return [ordered]@{
        hwnd = $Handle.ToInt64().ToString()
        focusHwnd = [LocalFlowWindows]::GetFocusedChild($Handle).ToInt64().ToString()
        processId = [int64]$processId
        processName = $processName
        title = [LocalFlowWindows]::GetTitle($Handle)
    }
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    $requestId = $null
    try {
        $request = $line | ConvertFrom-Json
        $requestId = $request.id
        $result = $null

        switch ($request.command) {
            "capture" {
                $result = Get-WindowInfo ([LocalFlowWindows]::GetForegroundWindow())
            }
            "findByTitle" {
                $handle = [LocalFlowWindows]::FindWindowByTitle(
                    [string]$request.title
                )
                $result = Get-WindowInfo $handle
            }
            "focus" {
                $handle = [IntPtr]([int64]([string]$request.hwnd))
                $focused = [LocalFlowWindows]::FocusWindow($handle)
                $result = [ordered]@{
                    focused = $focused
                    window = Get-WindowInfo $handle
                }
            }
            "paste" {
                $handle = [IntPtr]([int64]([string]$request.hwnd))
                $focusedChild = [IntPtr]([int64]([string]$request.focusHwnd))
                $method = [LocalFlowWindows]::PasteToWindow(
                    $handle,
                    $focusedChild
                )
                $result = [ordered]@{
                    focused = $method -eq "send-input"
                    pasted = $method -eq "send-input"
                    focusVerified = $method -eq "send-input"
                    deliveryVerified = $false
                    method = $method
                    reason = if ($method -eq "send-input") { $null } else { $method }
                    window = Get-WindowInfo $handle
                }
            }
            "sendToggleShortcut" {
                [LocalFlowWindows]::SendToggleShortcut()
                $result = [ordered]@{ sent = $true }
            }
            default {
                throw "Comando desconhecido: $($request.command)"
            }
        }

        $response = [ordered]@{
            id = $requestId
            ok = $true
            result = $result
        }
    } catch {
        $response = [ordered]@{
            id = $requestId
            ok = $false
            error = $_.Exception.Message
        }
    }

    [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
}
