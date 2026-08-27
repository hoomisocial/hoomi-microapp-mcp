import type { HoomiFormField } from "./client.js";
import type { HoomiFile } from "./types.js";

export function appendText(fields: HoomiFormField[], name: string, value: string | undefined): void {
  if (value !== undefined) {
    fields.push({ name, value });
  }
}

export function appendRepeated(fields: HoomiFormField[], name: string, values: string[] | undefined): void {
  for (const value of values ?? []) {
    fields.push({ name, value });
  }
}

export function appendFile(fields: HoomiFormField[], name: string, file: HoomiFile | undefined): void {
  if (file) {
    fields.push({
      name,
      value: new Blob([file.data], { type: file.contentType }),
      filename: file.filename
    });
  }
}
