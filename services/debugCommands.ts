type DebugCommand = (...args: any[]) => void;

const commands = new Map<string, { fn: DebugCommand; description: string }>();

function syncToWindow() {
  const w = window as any;
  w.__debug_commands = {};
  commands.forEach((value, name) => {
    w.__debug_commands[name] = value.description;
    w[name] = value.fn;
  });
  w.help = printHelp;
}

function printHelp() {
  if (commands.size === 0) {
    console.log('[DebugCommands] No commands registered.');
    return;
  }
  console.table(
    Array.from(commands.entries()).map(([name, { description }]) => ({
      Command: name,
      Description: description,
    }))
  );
}

export function registerCommand(name: string, fn: DebugCommand, description?: string): () => void {
  commands.set(name, { fn, description: description || '' });
  syncToWindow();
  return () => unregisterCommand(name);
}

export function unregisterCommand(name: string): void {
  commands.delete(name);
  const w = window as any;
  delete w[name];
  syncToWindow();
}

export function clearAllCommands(): void {
  const w = window as any;
  commands.forEach((_, name) => {
    delete w[name];
  });
  commands.clear();
  delete w.__debug_commands;
  delete w.help;
}
