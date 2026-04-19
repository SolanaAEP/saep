import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose-saep">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
