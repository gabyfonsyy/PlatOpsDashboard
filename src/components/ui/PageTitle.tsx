import { Copy } from "@/components/ui/Copy";
import { PAGE_NAMES, type PageKey } from "@/lib/nav";

/**
 * A page's <h1>, named per theme. No client JS and no hooks, so it drops straight into the server
 * components that own these headings.
 */
export function PageTitle({ page }: { page: PageKey }) {
  const { title } = PAGE_NAMES[page];
  return (
    <h1>
      <Copy serious={title.serious} playful={title.playful} />
    </h1>
  );
}

/** The same pair without the heading, for the few places a name appears outside an <h1>. */
export function PageName({ page, use = "nav" }: { page: PageKey; use?: "nav" | "title" }) {
  const name = PAGE_NAMES[page][use];
  return <Copy serious={name.serious} playful={name.playful} />;
}
