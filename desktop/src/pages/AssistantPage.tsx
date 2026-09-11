import AssistantChat from '../components/AssistantChat';

export default function AssistantPage() {
  return (
    <div className="h-full min-h-0 p-4 md:p-6">
      <div className="max-w-6xl mx-auto h-full min-h-0">
        <AssistantChat fullPage />
      </div>
    </div>
  );
}
