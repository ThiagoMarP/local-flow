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
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(
        IntPtr hWnd,
        bool altTab
    );

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

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

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam
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
    private const byte VK_CONTROL = 0x11;
    private const byte VK_SHIFT = 0x10;
    private const byte VK_MENU = 0x12;
    private const byte VK_SPACE = 0x20;
    private const byte VK_V = 0x56;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint WM_PASTE = 0x0302;

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
            keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
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
            ShowWindowAsync(target, SW_RESTORE);
            BringWindowToTop(target);
            bool focused = SetForegroundWindow(target);
            if (!focused && GetForegroundWindow() != target) {
                SwitchToThisWindow(target, true);
            }
            SetFocus(target);
            return focused || GetForegroundWindow() == target;
        } finally {
            if (attachedTarget) {
                AttachThreadInput(currentThread, targetThread, false);
            }
            if (attachedForeground) {
                AttachThreadInput(currentThread, foregroundThread, false);
            }
        }
    }

    public static void SendPaste() {
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    public static string PasteToWindow(IntPtr target) {
        if (target == IntPtr.Zero || !IsWindow(target)) return "failed";
        if (FocusWindow(target)) {
            System.Threading.Thread.Sleep(100);
            SendPaste();
            return "send-input";
        }

        uint processId;
        uint threadId = GetWindowThreadProcessId(target, out processId);
        var info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (GetGUIThreadInfo(threadId, ref info)) {
            IntPtr recipient = info.hwndFocus != IntPtr.Zero
                ? info.hwndFocus
                : info.hwndActive;
            if (recipient != IntPtr.Zero) {
                SendMessage(
                    recipient,
                    WM_PASTE,
                    IntPtr.Zero,
                    IntPtr.Zero
                );
                return "wm-paste";
            }
        }
        return "failed";
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
                $method = [LocalFlowWindows]::PasteToWindow($handle)
                $result = [ordered]@{
                    focused = $method -eq "send-input"
                    pasted = $method -ne "failed"
                    method = $method
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
