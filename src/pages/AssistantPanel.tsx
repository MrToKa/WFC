import { lazy, Suspense, useState } from 'react';
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  Spinner,
} from '@fluentui/react-components';
import { useAuth } from '@/context/AuthContext';
import { canReadCatalogs } from '@/utils/permissions';
import { useProjectDetailsStyles } from './ProjectDetails.styles';

const Workspace = lazy(() =>
  import('./Assistant').then((m) => ({ default: m.AssistantWorkspace })),
);
const ProjectPicker = lazy(() =>
  import('./Assistant').then((m) => ({ default: m.AssistantProjects })),
);

type Props = { projectId?: string; writable?: boolean; initiallyOpen?: boolean };

export function AssistantPanel({ projectId, writable = false, initiallyOpen = false }: Props) {
  const { user, token } = useAuth();
  const styles = useProjectDetailsStyles();
  const [chat, setChat] = useState<'initial' | 'open' | 'closed'>(
    initiallyOpen ? 'open' : 'initial',
  );
  if (
    !token ||
    !user ||
    !(projectId
      ? writable || user.role === 'technician'
      : canReadCatalogs(user) || user.role === 'technician')
  )
    return null;
  return (
    <Accordion
      id="project-assistant"
      collapsible
      openItems={chat === 'open' ? ['chat'] : []}
      onToggle={(_, data) => {
        setChat(data.openItems.length ? 'open' : 'closed');
      }}
    >
      <AccordionItem value="chat" className={styles.panel}>
        <AccordionHeader button={{ "aria-controls": "project-assistant-chat" }}>AI Assistant</AccordionHeader>
        <div id="project-assistant-chat" hidden={chat !== 'open'}>
          {chat !== 'initial' && (
            <Suspense fallback={<Spinner size="small" label="Зареждане на разговора" />}>
              {projectId ? (
                <Workspace
                  key={JSON.stringify([projectId, user.id, token])}
                  projectId={projectId}
                  token={token}
                  writable={writable}
                  admin={Boolean(user.isAdmin)}
                />
              ) : (
                <ProjectPicker key={JSON.stringify([user.id, token])} />
              )}
            </Suspense>
          )}
        </div>
      </AccordionItem>
    </Accordion>
  );
}
