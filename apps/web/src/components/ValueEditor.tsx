import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
export default function ValueEditor({
  value,
  theme,
  format,
  editable,
  onChange,
}: {
  value: string;
  theme: 'dark' | 'light';
  format: 'json' | 'text' | 'hex';
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const extensions = useMemo(
    () => [
      ...(format === 'json' ? [json()] : []),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'Key value editor' }),
      EditorView.theme({
        '&': { fontSize: '12.5px', height: '100%' },
        '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace' },
      }),
    ],
    [format],
  );
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={theme === 'dark' ? oneDark : 'light'}
      extensions={extensions}
      editable={editable}
      onChange={onChange}
      onCreateEditor={(view) => {
        view.scrollDOM.tabIndex = 0;
        view.scrollDOM.setAttribute('aria-label', 'Scroll key value');
      }}
      basicSetup={{
        highlightActiveLine: true,
        foldGutter: format === 'json',
        autocompletion: false,
      }}
    />
  );
}
