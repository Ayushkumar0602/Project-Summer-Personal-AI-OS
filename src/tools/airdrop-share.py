#!/usr/bin/env python3
"""
airdrop-share.py — Opens the macOS AirDrop share sheet for a file.
Uses PyObjC (or subprocess fallback) to invoke NSSharingService.
This script runs as a standalone process with its own GUI context,
which is required for the AirDrop share sheet to display.

Usage: python3 airdrop-share.py /path/to/file
"""

import sys
import subprocess
import os

def share_via_jxa(filepath):
    """Use osascript JXA with proper app context."""
    jxa = f'''
    ObjC.import("Cocoa");
    ObjC.import("AppKit");
    
    var app = $.NSApplication.sharedApplication;
    app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
    app.activateIgnoringOtherApps(true);
    
    var url = $.NSURL.fileURLWithPath("{filepath}");
    var service = $.NSSharingService.sharingServiceNamed($.NSSharingServiceNameSendViaAirDrop);
    
    if (service.js) {{
        service.performWithItems($.NSArray.arrayWithObject(url));
        // Keep the process alive for 60 seconds so the share sheet stays open
        $.NSRunLoop.currentRunLoop.runUntilDate(
            $.NSDate.dateWithTimeIntervalSinceNow(60)
        );
        "success";
    }} else {{
        "AirDrop not available";
    }}
    '''
    
    result = subprocess.run(
        ['osascript', '-l', 'JavaScript', '-e', jxa],
        capture_output=True, text=True, timeout=70
    )
    return result.stdout.strip() or result.stderr.strip()


def share_via_finder(filepath):
    """Fallback: Use Finder's Share menu."""
    # Select file in Finder
    subprocess.run(['osascript', '-e', f'''
        tell application "Finder"
            activate
            reveal POSIX file "{filepath}"
            select POSIX file "{filepath}"
        end tell
    '''], capture_output=True, timeout=5)
    
    import time
    time.sleep(0.5)
    
    # Click File → Share
    subprocess.run(['osascript', '-e', '''
        tell application "System Events"
            tell process "Finder"
                click menu item "Share…" of menu "File" of menu bar 1
            end tell
        end tell
    '''], capture_output=True, timeout=5)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 airdrop-share.py /path/to/file")
        sys.exit(1)
    
    filepath = os.path.expanduser(sys.argv[1])
    
    if not os.path.exists(filepath):
        print(f"Error: File not found: {filepath}")
        sys.exit(1)
    
    print(f"Opening AirDrop for: {os.path.basename(filepath)}")
    
    try:
        result = share_via_jxa(filepath)
        print(f"JXA result: {result}")
    except Exception as e:
        print(f"JXA failed: {e}, trying Finder fallback...")
        try:
            share_via_finder(filepath)
            print("Finder share menu opened")
        except Exception as e2:
            print(f"Both methods failed: {e2}")
            sys.exit(1)
