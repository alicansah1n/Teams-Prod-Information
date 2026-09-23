/** "{name}" yer tutucularını verilen değerlerle doldurur; bilinmeyenler olduğu gibi kalır. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}
