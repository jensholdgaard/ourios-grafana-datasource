import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { OuriosQuery, OuriosDataSourceOptions } from './types';

export const plugin = new DataSourcePlugin<DataSource, OuriosQuery, OuriosDataSourceOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
