import { useCallback, useMemo, useState } from 'react'
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react'
import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ModuleRegistry,
  NumberFilterModule,
  QuickFilterModule,
  TextFilterModule,
  type ColDef,
  type GridApi,
} from 'ag-grid-community'
import type { DashboardOrder } from '../api/types'
import { formatCents, toCents } from '../dashboardMoney'
import { STATUS_LABELS } from '../orderStatus'
import { dashboardTheme } from './dashboardTheme'
import styles from './DashboardGrid.module.css'

// Only Community modules (ADR-0019): an Enterprise module needs a paid licence.
ModuleRegistry.registerModules([
  CellStyleModule,
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  ColumnApiModule,
  TextFilterModule,
  NumberFilterModule,
  QuickFilterModule,
])

// A status is shown as words (with a tick once it is past the kitchen), not by colour alone.
function StatusCell({ data }: CustomCellRendererProps<DashboardOrder>) {
  if (data === undefined) return null
  const done = data.status === 'ready' || data.status === 'out_for_delivery' || data.status === 'completed'
  return (
    <span className={`${styles.tag} ${done ? styles.tagDone : ''} ${data.status === 'cancelled' ? styles.tagCancelled : ''}`}>
      {done && <span aria-hidden="true">✓ </span>}
      {STATUS_LABELS[data.status]}
    </span>
  )
}

const TYPE_LABELS = { pickup: 'Pickup', delivery: 'Delivery' } as const

// The columns, in the order they are shown. Order stays in view on the left while the others
// scroll. The amounts sort and filter as numbers.
const COLUMNS: ColDef<DashboardOrder>[] = [
  { colId: 'id', headerName: 'Order', field: 'id', pinned: 'left', width: 120, filter: 'agNumberColumnFilter' },
  { colId: 'restaurant', headerName: 'Restaurant', field: 'restaurant_name', filter: 'agTextColumnFilter', minWidth: 150, flex: 2 },
  { colId: 'customer', headerName: 'Customer', field: 'customer_name', filter: 'agTextColumnFilter', minWidth: 140, flex: 2 },
  {
    colId: 'type',
    headerName: 'Type',
    valueGetter: (p) => (p.data === undefined ? '' : TYPE_LABELS[p.data.fulfilment_type]),
    filter: 'agTextColumnFilter',
    width: 130,
  },
  {
    colId: 'status',
    headerName: 'Status',
    valueGetter: (p) => (p.data === undefined ? '' : STATUS_LABELS[p.data.status]),
    cellRenderer: StatusCell,
    filter: 'agTextColumnFilter',
    minWidth: 180,
    flex: 2,
  },
  { colId: 'items', headerName: 'Items', field: 'item_count', filter: 'agNumberColumnFilter', type: 'numericColumn', width: 110 },
  {
    colId: 'total',
    headerName: 'Total',
    valueGetter: (p) => (p.data === undefined ? 0 : toCents(p.data.total) / 100),
    valueFormatter: (p) => formatCents(Math.round(Number(p.value) * 100)),
    filter: 'agNumberColumnFilter',
    type: 'numericColumn',
    width: 120,
  },
  {
    colId: 'placed',
    headerName: 'Placed',
    field: 'created_at',
    valueFormatter: (p) => {
      const time = new Date(String(p.value))
      return Number.isNaN(time.getTime())
        ? ''
        : time.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    },
    initialSort: 'desc',
    minWidth: 170,
    flex: 2,
  },
]

const DEFAULT_COLUMN: ColDef<DashboardOrder> = {
  sortable: true,
  resizable: true,
  floatingFilter: true,
  suppressHeaderMenuButton: true,
}

interface Totals {
  count: number
  cents: number
  cancelled: number
}

function totalsOf(api: GridApi<DashboardOrder>): Totals {
  const totals: Totals = { count: 0, cents: 0, cancelled: 0 }
  api.forEachNodeAfterFilter((node) => {
    if (node.data === undefined) return
    totals.count += 1
    totals.cents += toCents(node.data.total)
    if (node.data.status === 'cancelled') totals.cancelled += 1
  })
  return totals
}

// The orders table (S34): sort, filter, search, and a totals line that follows the
// rows left after the filters and the search. It only shows orders; there is no order button.
function DashboardGrid({ orders, search }: { orders: DashboardOrder[]; search: string }) {
  const [totals, setTotals] = useState<Totals>({ count: 0, cents: 0, cancelled: 0 })

  const sync = useCallback((grid: GridApi<DashboardOrder>) => setTotals(totalsOf(grid)), [])

  const themed = useMemo(() => dashboardTheme(), [])

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        <AgGridReact<DashboardOrder>
          theme={themed}
          rowData={orders}
          columnDefs={COLUMNS}
          defaultColDef={DEFAULT_COLUMN}
          getRowId={(params) => String(params.data.id)}
          quickFilterText={search}
          suppressColumnVirtualisation
          onGridReady={(event) => sync(event.api)}
          onFilterChanged={(event) => sync(event.api)}
          onRowDataUpdated={(event) => sync(event.api)}
        />
      </div>

      <p className={styles.totals} role="status">
        <strong>
          Showing {totals.count} {totals.count === 1 ? 'order' : 'orders'} · {formatCents(totals.cents)}
        </strong>
        {totals.cancelled > 0 && (
          <span className={styles.note}>
            {' '}
            Includes {totals.cancelled} cancelled {totals.cancelled === 1 ? 'order' : 'orders'}. Filter Status to leave them out.
          </span>
        )}
      </p>
    </div>
  )
}

export default DashboardGrid
