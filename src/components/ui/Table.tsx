import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff } from 'lucide-react';

export interface TableColumn<T> {
  key: string;
  title: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string;
  hideable?: boolean;
  defaultHidden?: boolean;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
  expandable?: (row: T) => React.ReactNode;
  expandKey?: (row: T) => string;
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  className?: string;
  dense?: boolean;
}

/** 密集表格基元（32-36px 行高、右对齐数字、排序/隐藏列） */
export function Table<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  expandable,
  expandKey,
  defaultSortKey,
  defaultSortDir = 'desc',
  className,
  dense,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [colMenuOpen, setColMenuOpen] = useState(false);

  const visibleColumns = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (col: TableColumn<T>) => {
    if (!col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('desc');
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCol = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const alignClass = (align?: 'left' | 'right' | 'center') =>
    align === 'right' ? 'text-right num' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <div className={clsx('overflow-x-auto', className)}>
      <div className="flex justify-end mb-1 relative">
        <button
          onClick={() => setColMenuOpen((v) => !v)}
          className="text-[11px] text-secondary hover:text-primary flex items-center gap-1 px-2 py-0.5 rounded hover:bg-card-hover"
        >
          <Eye size={12} /> 列设置
        </button>
        {colMenuOpen && (
          <div className="absolute right-0 top-6 z-30 panel p-2 min-w-[160px] shadow-glow">
            {columns
              .filter((c) => c.hideable !== false)
              .map((c) => (
                <label
                  key={c.key}
                  className="flex items-center gap-2 px-2 py-1 text-[12px] text-primary hover:bg-card-hover rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() => toggleCol(c.key)}
                    className="accent-declared"
                  />
                  {c.title}
                  {c.defaultHidden && <EyeOff size={11} className="text-disabled ml-auto" />}
                </label>
              ))}
          </div>
        )}
      </div>
      <table className={clsx('tbl', dense && 'text-[12px]')}>
        <thead>
          <tr>
            {expandable && <th className="w-6" />}
            {visibleColumns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={clsx(alignClass(col.align), col.sortValue && 'cursor-pointer hover:text-primary')}
                onClick={() => toggleSort(col)}
              >
                <span className="inline-flex items-center gap-0.5">
                  {col.title}
                  {col.sortValue &&
                    (sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ChevronUp size={11} className="text-declared" />
                      ) : (
                        <ChevronDown size={11} className="text-declared" />
                      )
                    ) : (
                      <ChevronDown size={11} className="opacity-30" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const key = rowKey(row);
            const expKey = expandKey ? expandKey(row) : key;
            const isOpen = expanded.has(expKey);
            return (
              <React.Fragment key={key}>
                <tr
                  className={clsx(rowClassName?.(row), 'cursor-pointer')}
                  onClick={() => expandable && toggleExpand(expKey)}
                >
                  {expandable && (
                    <td className="text-secondary">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={alignClass(col.align)} style={{ width: col.width }}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
                {isOpen && expandable && (
                  <tr className="bg-[#101722]">
                    <td />
                    <td colSpan={visibleColumns.length} className="!p-0">
                      {expandable(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
