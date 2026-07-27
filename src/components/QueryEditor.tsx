import React, { ChangeEvent } from 'react';
import { InlineField, TextArea } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { OuriosDataSourceOptions, OuriosQuery } from '../types';

type Props = QueryEditorProps<DataSource, OuriosQuery, OuriosDataSourceOptions>;

export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  const onDslChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...query, dsl: event.target.value });
  };

  return (
    <InlineField
      label="Logs DSL"
      labelWidth={14}
      grow
      interactive
      tooltip="RFC 0002 logs DSL. The dashboard time range is injected as a range(...) stage unless the query already has one. `count by bucket(5m)` graphs; `count by <field>` tabulates; anything else returns log lines."
    >
      <TextArea
        id="query-editor-dsl"
        onChange={onDslChange}
        onBlur={onRunQuery}
        value={query.dsl ?? ''}
        rows={3}
        placeholder='severity >= warn | limit 100'
      />
    </InlineField>
  );
}
