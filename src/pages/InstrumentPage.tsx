import React from 'react';
import { useParams } from 'react-router-dom';
import { InstrumentDetail } from '@/components/detail/InstrumentDetail';

/** 标的详情页（路由 /instruments/:id） */
export function InstrumentPage() {
  const { id } = useParams<{ id: string }>();
  return <InstrumentDetail key={id} />;
}
