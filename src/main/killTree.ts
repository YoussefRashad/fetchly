import { execFile, type ChildProcess } from 'node:child_process';

/** Ends a process tree: taskkill /T /F on the child's pid, falling back to child.kill() when taskkill fails. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  // yt-dlp starts ffmpeg; /T takes the children down with it.
  execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (err) => {
    if (err) child.kill();
  });
}
