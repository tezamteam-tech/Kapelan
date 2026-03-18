import { DocumentsPanel } from "../DocumentsPanel";

export function DocumentsPage() {
  return (
    <div className="h-full overflow-auto p-4 lg:p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-slate-800 mb-4">Документы</h2>
        <p className="text-sm text-slate-500 mb-6">
          Генерация документов доступна из карточки заявки в разделе «Заявки».
          Выберите заявку со статусом КП или Сделка, чтобы создать договор и спецификацию.
        </p>
        <div className="bg-white rounded-2xl border border-slate-100 p-8 flex flex-col items-center justify-center text-center">
          <span className="text-5xl mb-3">📄</span>
          <p className="text-lg font-semibold text-slate-700">Перейдите в раздел «Заявки»</p>
          <p className="text-sm text-slate-500 mt-1">
            Документы генерируются из карточки конкретной заявки после создания КП
          </p>
        </div>
      </div>
    </div>
  );
}