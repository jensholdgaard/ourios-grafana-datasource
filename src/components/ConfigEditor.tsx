import React, { ChangeEvent } from 'react';
import { InlineField, Input } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { OuriosDataSourceOptions } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<OuriosDataSourceOptions> {}

export function ConfigEditor({ onOptionsChange, options }: Props) {
  const { jsonData } = options;

  const onUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, url: event.target.value } });
  };

  const onTenantChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, tenant: event.target.value } });
  };

  return (
    <>
      <InlineField
        label="Querier URL"
        labelWidth={18}
        interactive
        tooltip="Base URL of the Ourios querier (RFC 0016). From a Grafana container on Docker Desktop or colima, the host is reachable as host.docker.internal."
      >
        <Input
          id="config-editor-url"
          onChange={onUrlChange}
          value={jsonData.url ?? ''}
          placeholder="http://host.docker.internal:4319"
          width={48}
        />
      </InlineField>
      <InlineField
        label="Tenant"
        labelWidth={18}
        interactive
        tooltip="Sent as x-ourios-tenant. Every Ourios read path is tenant-scoped (RFC 0026), so this is required."
      >
        <Input
          id="config-editor-tenant"
          onChange={onTenantChange}
          value={jsonData.tenant ?? ''}
          placeholder="agent-dogfood"
          width={48}
        />
      </InlineField>
    </>
  );
}
