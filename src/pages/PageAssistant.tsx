import { useState, type FormEvent } from 'react';
import { Button, Field, Textarea } from '@fluentui/react-components';
import { request } from '@/api/http';

export type AssistantCatalog = {
  endpoint: string;
  label: string;
  onCreated: () => void;
};

export function PageAssistant({ token, page, catalog }: {
  token: string;
  page: string;
  catalog?: AssistantCatalog;
}) {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setAnswer('');
    setError('');
    try {
      const result = await request<{ answer: string; created?: number }>(
        catalog ? `/api/materials/${catalog.endpoint}/assistant` : '/api/assistant/page',
        { method: 'POST', token, body: catalog ? { prompt } : { prompt, page } },
      );
      if (result.created) {
        setAnswer(`Added ${result.created} item(s) to ${catalog?.label}.`);
        catalog?.onCreated();
      } else {
        setAnswer(result.answer);
      }
      setPrompt('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Assistant request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Message to AI Assistant"
        hint={catalog ? `Requests to add items are saved directly to ${catalog.label}.` : undefined}>
        <Textarea value={prompt} onChange={(_, data) => setPrompt(data.value)} maxLength={12000} disabled={busy} />
      </Field>
      <Button type="submit" appearance="primary" disabled={busy || !prompt.trim()}>
        {busy ? 'Sending…' : 'Send'}
      </Button>
      {answer && <p role="status" style={{ whiteSpace: 'pre-wrap' }}>{answer}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}