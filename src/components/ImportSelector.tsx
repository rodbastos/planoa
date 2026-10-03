import { importDate, useImports } from "../hooks/useImports";
import { formatDate } from "../lib/format";
import { Select } from "./ui/Input";

/** Dropdown para escolher qual planilha importada alimenta as páginas */
export function ImportSelector({ className }: { className?: string }) {
  const { imports, selected, selectImport } = useImports();

  if (!selected || imports.length <= 1) return null;

  return (
    <Select
      className={className}
      value={selected.id}
      onChange={(e) => selectImport(e.target.value)}
      title="Planilha exibida"
    >
      {imports.map((imp) => (
        <option key={imp.id} value={imp.id}>
          {formatDate(importDate(imp))} · {imp.fileName}
        </option>
      ))}
    </Select>
  );
}
