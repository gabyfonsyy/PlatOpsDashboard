"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

export function DeleteButton({ endpoint, id }: { endpoint: string; id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this record?")) return;
    setLoading(true);
    await fetch(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-neutral-400 hover:text-red-600 transition-colors disabled:opacity-50"
      aria-label="Delete"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
