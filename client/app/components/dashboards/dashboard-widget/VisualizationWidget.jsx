import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { compact, isEmpty, invoke } from 'lodash';
import { markdown } from 'markdown';
import classNames from 'classnames';
import Menu from 'antd/lib/menu';
import { currentUser } from '@/services/auth';
import recordEvent from '@/services/recordEvent';
import { $location } from '@/services/ng';
import { formatDateTime } from '@/filters/datetime';
import HtmlContent from '@/components/HtmlContent';
import { Parameters } from '@/components/Parameters';
import { TimeAgo } from '@/components/TimeAgo';
import QueryLink from '@/components/QueryLink';
import { FiltersType } from '@/components/Filters';
import ExpandedWidgetDialog from '@/components/dashboards/ExpandedWidgetDialog';
import EditParameterMappingsDialog from '@/components/dashboards/EditParameterMappingsDialog';
import { VisualizationRenderer } from '@/visualizations/VisualizationRenderer';
import Widget from './Widget';

function visualizationWidgetMenuOptions(widget, canEditDashboard, onParametersEdit) {
  const canViewQuery = currentUser.hasPermission('view_query');
  const canEditParameters = canEditDashboard && !isEmpty(invoke(widget, 'query.getParametersDefs'));
  const widgetQueryResult = widget.getQueryResult();
  const isQueryResultEmpty = !widgetQueryResult || !widgetQueryResult.isEmpty || widgetQueryResult.isEmpty();

  const downloadLink = fileType => widgetQueryResult.getLink(widget.getQuery().id, fileType);
  const downloadName = fileType => widgetQueryResult.getName(widget.getQuery().name, fileType);
  return compact([
    <Menu.Item key="download_csv" disabled={isQueryResultEmpty}>
      {!isQueryResultEmpty ? (
        <a href={downloadLink('csv')} download={downloadName('csv')} target="_self">
          Download as CSV File
        </a>
      ) : 'Download as CSV File'}
    </Menu.Item>,
    <Menu.Item key="download_excel" disabled={isQueryResultEmpty}>
      {!isQueryResultEmpty ? (
        <a href={downloadLink('xlsx')} download={downloadName('xlsx')} target="_self">
          Download as Excel File
        </a>
      ) : 'Download as Excel File'}
    </Menu.Item>,
    ((canViewQuery || canEditParameters) && <Menu.Divider key="divider" />),
    canViewQuery && (
      <Menu.Item key="view_query">
        <a href={widget.getQuery().getUrl(true, widget.visualization.id)}>View Query</a>
      </Menu.Item>
    ),
    (canEditParameters && (
      <Menu.Item
        key="edit_parameters"
        onClick={onParametersEdit}
      >
        Edit Parameters
      </Menu.Item>
    )),
  ]);
}

function VisualizationWidgetHeader({ widget, parameters, onParametersUpdate }) {
  const canViewQuery = currentUser.hasPermission('view_query');

  return (
    <>
      <div className="t-header widget clearfix">
        <div className="th-title">
          <p>
            <QueryLink query={widget.getQuery()} visualization={widget.visualization} readOnly={!canViewQuery} />
          </p>
          <HtmlContent className="text-muted query--description">
            {markdown.toHTML(widget.getQuery().description || '')}
          </HtmlContent>
        </div>
      </div>
      {!isEmpty(parameters) && (
        <div className="m-b-10">
          <Parameters parameters={parameters} onValuesChange={onParametersUpdate} />
        </div>
      )}
    </>
  );
}

VisualizationWidgetHeader.propTypes = {
  widget: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  parameters: PropTypes.arrayOf(PropTypes.object),
  onParametersUpdate: PropTypes.func,
};

VisualizationWidgetHeader.defaultProps = { onParametersUpdate: () => {}, parameters: [] };

function VisualizationWidgetFooter({ widget, isPublic, onRefresh, onExpand }) {
  const widgetQueryResult = widget.getQueryResult();
  const updatedAt = widgetQueryResult && widgetQueryResult.getUpdatedAt();
  const [refreshClickButtonId, setRefreshClickButtonId] = useState();

  const refreshWidget = (buttonId) => {
    if (!refreshClickButtonId) {
      setRefreshClickButtonId(buttonId);
      onRefresh().finally(() => setRefreshClickButtonId(null));
    }
  };

  return (
    <>
      {(!isPublic && !!widgetQueryResult) && (
        <a
          className="refresh-button hidden-print btn btn-sm btn-default btn-transparent"
          onClick={() => refreshWidget(1)}
          data-test="RefreshButton"
        >
          <i className={classNames('zmdi zmdi-refresh', { 'zmdi-hc-spin': refreshClickButtonId === 1 })} />{' '}
          <TimeAgo date={updatedAt} />
        </a>
      )}
      <span className="visible-print">
        <i className="zmdi zmdi-time-restore" />{' '}{formatDateTime(updatedAt)}
      </span>
      {isPublic ? (
        <span className="small hidden-print">
          <i className="zmdi zmdi-time-restore" />{' '}<TimeAgo date={updatedAt} />
        </span>
      ) : (
        <a
          className="btn btn-sm btn-default pull-right hidden-print btn-transparent btn__refresh"
          onClick={() => refreshWidget(2)}
        >
          <i className={classNames('zmdi zmdi-refresh', { 'zmdi-hc-spin': refreshClickButtonId === 2 })} />
        </a>
      )}
      <a
        className="btn btn-sm btn-default pull-right hidden-print btn-transparent btn__refresh"
        onClick={onExpand}
      >
        <i className="zmdi zmdi-fullscreen" />
      </a>
    </>
  );
}

VisualizationWidgetFooter.propTypes = {
  widget: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  isPublic: PropTypes.bool,
  onRefresh: PropTypes.func.isRequired,
  onExpand: PropTypes.func.isRequired,
};

VisualizationWidgetFooter.defaultProps = { isPublic: false };

class VisualizationWidget extends React.Component {
  static propTypes = {
    widget: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
    dashboard: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
    filters: FiltersType,
    isPublic: PropTypes.bool,
    canEdit: PropTypes.bool,
    onDelete: PropTypes.func,
    onParameterMappingsChange: PropTypes.func,
  };

  static defaultProps = {
    filters: [],
    isPublic: false,
    canEdit: false,
    onDelete: () => {},
    onParameterMappingsChange: () => {},
  };

  constructor(props) {
    super(props);
    const widgetQueryResult = props.widget.getQueryResult();
    const widgetStatus = widgetQueryResult && widgetQueryResult.getStatus();

    this.state = { widgetStatus, localParameters: props.widget.getLocalParameters() };
  }

  componentDidMount() {
    const { widget } = this.props;
    recordEvent('view', 'query', widget.visualization.query.id, { dashboard: true });
    recordEvent('view', 'visualization', widget.visualization.id, { dashboard: true });
    this.loadWidget();
  }

  loadWidget = (refresh = false) => {
    const { widget } = this.props;
    const maxAge = $location.search().maxAge;
    return widget.load(refresh, maxAge).then(({ status }) => {
      this.setState({ widgetStatus: status });
    }).catch(() => {
      this.setState({ widgetStatus: 'failed' });
    });
  };

  refreshWidget = () => this.loadWidget(true);

  expandWidget = () => {
    ExpandedWidgetDialog.showModal({ widget: this.props.widget });
  };

  editParameterMappings = () => {
    const { widget, dashboard, onParameterMappingsChange } = this.props;
    EditParameterMappingsDialog.showModal({
      dashboard,
      widget,
    }).result.then((valuesChanged) => {
      // refresh widget if any parameter value has been updated
      if (valuesChanged) {
        this.refresh();
      }
      onParameterMappingsChange();
      this.setState({ localParameters: widget.getLocalParameters() });
    });
  };

  // eslint-disable-next-line class-methods-use-this
  renderVisualization() {
    const { widget, filters } = this.props;
    const { widgetStatus } = this.state;
    const widgetQueryResult = widget.getQueryResult();
    switch (widgetStatus) {
      case 'failed':
        return (
          <div className="body-row-auto scrollbox">
            {widgetQueryResult.getError() && (
              <div className="alert alert-danger m-5">
                Error running query: <strong>{widgetQueryResult.getError()}</strong>
              </div>
            )}
          </div>
        );
      case 'done':
        return (
          <div className="body-row-auto scrollbox">
            <VisualizationRenderer
              visualization={widget.visualization}
              queryResult={widgetQueryResult}
              filters={filters}
            />
          </div>
        );
      default:
        return (
          <div className="body-row-auto spinner-container">
            <div className="spinner">
              <i className="zmdi zmdi-refresh zmdi-hc-spin zmdi-hc-5x" />
            </div>
          </div>
        );
    }
  }

  render() {
    const { widget, isPublic, canEdit } = this.props;
    const { localParameters } = this.state;
    const widgetQueryResult = widget.getQueryResult();
    const isRefreshing = widget.loading && !!(widgetQueryResult && widgetQueryResult.getStatus());

    return (
      <Widget
        {...this.props}
        className="widget-visualization"
        menuOptions={visualizationWidgetMenuOptions(widget, canEdit, this.editParameterMappings)}
        header={(
          <VisualizationWidgetHeader
            widget={widget}
            parameters={localParameters}
            onParametersUpdate={this.refreshWidget}
          />
        )}
        footer={(
          <VisualizationWidgetFooter
            widget={widget}
            isPublic={isPublic}
            onRefresh={this.refreshWidget}
            onExpand={this.expandWidget}
          />
        )}
        refreshStartedAt={isRefreshing ? widget.refreshStartedAt : null}
      >
        {this.renderVisualization()}
      </Widget>
    );
  }
}

export default VisualizationWidget;