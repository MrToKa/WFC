import { Tab, TabList } from '@fluentui/react-components';
import { useSearchParams } from 'react-router-dom';
import { ProjectLocationReview } from '../ProjectLocationReview';
import { PilotPage } from '../GvlStage5/GvlStage5';
import { GVL_PILOT_ID } from '../GvlStage5/pilotId';
import type { ComponentProps, ReactNode } from 'react';

export function LocatorPanel({ assignmentPanel, ...props }: ComponentProps<typeof ProjectLocationReview> & { assignmentPanel?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const pilot = params.get('panel') === 'pilot';
  return (
    <>
      <TabList
        selectedValue={pilot ? 'pilot' : 'review'}
        size="small"
        style={{ flexWrap: 'wrap' }}
        aria-label="Locator"
        onTabSelect={(_, data) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            if (data.value === 'pilot') next.set('panel', 'pilot');
            else next.delete('panel');
            return next;
          })
        }
      >
        <Tab value="review" id="locator-review-tab" aria-controls="locator-content">
          Преглед на локациите
        </Tab>
        <Tab value="pilot" id="locator-pilot-tab" aria-controls="locator-content">
          Отчет на пилота
        </Tab>
      </TabList>
      <div
        role="tabpanel"
        id="locator-content"
        aria-labelledby={pilot ? 'locator-pilot-tab' : 'locator-review-tab'}
      >
        {pilot ? (
          props.projectId === GVL_PILOT_ID && props.admin ? (
            <PilotPage projectId={props.projectId} token={props.token} />
          ) : (
            <p>Няма достъпен пилотен отчет за този проект.</p>
          )
        ) : (
          <>{assignmentPanel}<ProjectLocationReview {...props} /></>
        )}
      </div>
    </>
  );
}
