type SaveHandle = {
  createWritable(): Promise<{
    write(blob: Blob): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
};
type SaveWindow = Window & {
  showSaveFilePicker?: (options: {
    id: string;
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<SaveHandle>;
};
export const canChooseSavePath = () =>
  typeof (window as SaveWindow).showSaveFilePicker === 'function';
/** Call directly from a click, before any fetch, to preserve the required user activation. */
export async function chooseZipDestination(name: string): Promise<(blob: Blob) => Promise<void>> {
  const filename = `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 70)}-全局存档.zip`;
  const picker = (window as SaveWindow).showSaveFilePicker;
  if (picker) {
    const handle = await picker.call(window, {
      id: 'interlude-room-archive',
      suggestedName: filename,
      types: [{ description: '幕间房间存档', accept: { 'application/zip': ['.zip'] } }],
    });
    return async (blob) => {
      const stream = await handle.createWritable();
      try {
        await stream.write(blob);
        await stream.close();
      } catch (error) {
        await stream.abort().catch(() => {});
        throw error;
      }
    };
  }
  return async (blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
}
