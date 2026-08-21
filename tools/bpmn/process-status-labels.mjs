const technicalStatuses = {
  draft: 'Черновик',
  'review-ready': 'Готов к проверке владельцем',
  rework: 'Требует доработки',
  approved: 'Решение об утверждении зафиксировано',
  rejected: 'Решение об отклонении зафиксировано'
};

const businessStatuses = {
  pending_human_decision: 'Ожидает решения владельца',
  canonical: 'Отмечен как канонический',
  rejected: 'Отмечен как отклонённый'
};

export function humanProcessStatus(meta) {
  const technical = technicalStatuses[meta?.status] || `Технический статус: ${meta?.status || 'не указан'}`;
  const business = businessStatuses[meta?.canonicality?.business_status]
    || `Бизнес-статус: ${meta?.canonicality?.business_status || 'не указан'}`;
  return `${technical} · ${business}`;
}
