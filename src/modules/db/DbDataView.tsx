import DbDataContextMenu from "./DbDataContextMenu";
import DbDataFilterPanel from "./DbDataFilterPanel";
import DbDataPager from "./DbDataPager";
import DbResultGrid from "./DbResultGrid";
import useDbDataView from "./useDbDataView";
import type { DbDataViewProps } from "./dbDataViewTypes";

export default function DbDataView(props: DbDataViewProps) {
  const {
    t,
    result,
    loading,
    error,
    page,
    pageSize,
    sort,
    filterOpen,
    filterApplying,
    filterCount,
    draft,
    selectedRows,
    selectedCount,
    menu,
    inserting,
    canMutate,
    total,
    paginationTotal,
    resetKey,
    draftRow,
    addDisabled,
    deleteDisabled,
    saveDisabled,
    cancelDisabled,
    handleSort,
    selectRow,
    openRowMenu,
    closeMenu,
    deleteSelected,
    commitCell,
    openFilter,
    addFilter,
    patchFilter,
    removeFilter,
    applyFilters,
    resetFilters,
    addRow,
    cancelRow,
    saveRow,
    refreshData,
    changePage,
  } = useDbDataView(props);

  return (
    <div
      className="db-data-view"
      onClick={() => menu && closeMenu()}
      onMouseDownCapture={(event) => {
        if (event.shiftKey) {
          event.preventDefault();
          window.getSelection()?.removeAllRanges();
        }
      }}
      onMouseUpCapture={(event) => {
        if (event.shiftKey) window.getSelection()?.removeAllRanges();
      }}
    >
      <DbDataFilterPanel
        columns={result?.columns ?? []}
        filterCount={filterCount}
        filterOpen={filterOpen}
        filterApplying={filterApplying}
        draft={draft}
        disabled={!result}
        onToggle={openFilter}
        onAdd={addFilter}
        onPatch={patchFilter}
        onRemove={removeFilter}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <div className="db-grid-area">
        {error ? (
          <div className="db-error">{error}</div>
        ) : (
          <DbResultGrid
            columns={result?.columns ?? []}
            rows={result?.rows ?? []}
            loading={loading}
            emptyText={t("db.emptyTable")}
            sort={sort}
            onSort={handleSort}
            selectedRows={selectedRows}
            onRowSelect={selectRow}
            onRowContextMenu={openRowMenu}
            editable={canMutate}
            resetKey={resetKey}
            onCellCommit={(rowIndex, columnIndex, value) => {
              void commitCell(rowIndex, columnIndex, value);
            }}
            draft={draftRow}
          />
        )}
      </div>

      <DbDataPager
        addDisabled={addDisabled}
        deleteDisabled={deleteDisabled}
        saveDisabled={saveDisabled}
        cancelDisabled={cancelDisabled}
        inserting={inserting}
        canMutate={canMutate}
        selectedCount={selectedCount}
        total={total}
        rowCount={result?.rows.length ?? 0}
        page={page}
        pageSize={pageSize}
        paginationTotal={paginationTotal}
        onAdd={addRow}
        onDelete={deleteSelected}
        onSave={() => void saveRow()}
        onCancel={cancelRow}
        onRefresh={refreshData}
        onPageChange={changePage}
      />

      {menu && (
        <DbDataContextMenu
          x={menu.x}
          y={menu.y}
          canDelete={canMutate && selectedCount > 0}
          selectedCount={selectedCount}
          onDelete={() => {
            closeMenu();
            deleteSelected();
          }}
        />
      )}
    </div>
  );
}
