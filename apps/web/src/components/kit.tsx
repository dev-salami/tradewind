"use client";
import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronsUpDown,
  ListFilter,
  Search,
} from "lucide-react";
export { Card, Kpi, Avatar, Pill } from "./surfaces";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  sort?: (row: T) => string | number;
  className?: string;
};
export function DataTable<T>({
  title,
  rows,
  columns,
  rowKey,
  searchText,
  filters,
  pageSize = 8,
  label,
  empty = "Nothing matches these filters.",
  headExtra,
}: {
  title: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchText?: (row: T) => string;
  filters?: { label: string; options: string[]; value: (row: T) => string };
  pageSize?: number;
  label?: string;
  empty?: string;
  headExtra?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [showFilter, setShowFilter] = useState(false);
  const shown = useMemo(() => {
    let xs = rows;
    if (query && searchText) {
      const q = query.toLowerCase();
      xs = xs.filter((r) => searchText(r).toLowerCase().includes(q));
    }
    if (filters && filter !== "All")
      xs = xs.filter((r) => filters.value(r) === filter);
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sort) {
        const f = col.sort;
        xs = [...xs].sort((a, b) => {
          const x = f(a);
          const y = f(b);
          return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
        });
      }
    }
    return xs;
  }, [rows, query, filter, sort, columns, filters, searchText]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * pageSize, current * pageSize + pageSize);
  const toggle = (key: string) =>
    setSort((s) =>
      s?.key === key
        ? s.dir === 1
          ? { key, dir: -1 }
          : null
        : { key, dir: 1 },
    );
  const sortable = columns.filter((c) => c.sort);
  return (
    <section className="tw-card tw-table-card" aria-label={label ?? title}>
      <div className="tw-card-head tw-table-head">
        <h2>{title}</h2>
        <div className="tw-table-tools">
          {headExtra}
          {searchText && (
            <label className="tw-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search…"
                aria-label={`Search ${title}`}
              />
            </label>
          )}
          {filters && (
            <div className="tw-pop-wrap">
              <button
                type="button"
                className={`tw-ghost ${filter !== "All" ? "on" : ""}`}
                onClick={() => setShowFilter((v) => !v)}
                aria-expanded={showFilter}
              >
                {filter === "All" ? "Filter" : filter}{" "}
                <ListFilter size={15} aria-hidden="true" />
              </button>
              {showFilter && (
                <div className="tw-pop" role="menu" aria-label={filters.label}>
                  {["All", ...filters.options].map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="menuitemradio"
                      aria-checked={filter === o}
                      className={filter === o ? "on" : ""}
                      onClick={() => {
                        setFilter(o);
                        setShowFilter(false);
                        setPage(0);
                      }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {sortable.length > 0 && (
            <label className="tw-ghost tw-sortby">
              <span>Sort by</span>
              <select
                aria-label={`Sort ${title}`}
                value={sort ? `${sort.key}:${sort.dir}` : ""}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(":");
                  setSort(key ? { key, dir: Number(dir) as 1 | -1 } : null);
                }}
              >
                <option value="">Default</option>
                {sortable.map((c) => (
                  <option key={c.key + "a"} value={`${c.key}:1`}>
                    {c.label} ↑
                  </option>
                ))}
                {sortable.map((c) => (
                  <option key={c.key + "d"} value={`${c.key}:-1`}>
                    {c.label} ↓
                  </option>
                ))}
              </select>
              <ArrowUpDown size={15} aria-hidden="true" />
            </label>
          )}
        </div>
      </div>
      <div className="tw-table-scroll">
        <table className="tw-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.className}
                  aria-sort={
                    sort?.key === c.key
                      ? sort.dir === 1
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {c.sort ? (
                    <button type="button" onClick={() => toggle(c.key)}>
                      {c.label} <ChevronsUpDown size={13} aria-hidden="true" />
                    </button>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.className} data-label={c.label}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {slice.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="tw-empty">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > pageSize && (
        <div className="tw-pager">
          <span>
            {current * pageSize + 1}–
            {Math.min(shown.length, (current + 1) * pageSize)} of {shown.length}
          </span>
          <button
            type="button"
            className="tw-ghost"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="tw-ghost"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="tw-select">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export function useToast() {
  const [msg, setMsg] = useState("");
  const node = msg ? (
    <div className="tw-toast" role="status">
      {msg}
      <button type="button" onClick={() => setMsg("")} aria-label="Dismiss">
        ×
      </button>
    </div>
  ) : null;
  return { show: setMsg, node };
}
