import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  BeakerIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  getPendingLabOrders,
  getCriticalResults,
  addLabResult,
  reviewLabResult,
  updateLabOrderStatus,
  type LabOrder,
} from "@/services/labs";
import { useToast } from "@/stores/toast";

const resultSchema = z.object({
  resultValue: z.string().min(1, "Result value is required"),
  resultUnit: z.string().optional(),
  referenceRange: z.string().optional(),
  interpretation: z.enum(["normal", "abnormal", "critical"]),
  notes: z.string().optional(),
});

type ResultFormData = z.infer<typeof resultSchema>;

interface LabResultsDashboardProps {
  userId: string;
}

export function LabResultsDashboard({ userId }: LabResultsDashboardProps) {
  const [pendingOrders, setPendingOrders] = useState<LabOrder[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [criticalResults, setCriticalResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<LabOrder | null>(null);
  const [showResultForm, setShowResultForm] = useState(false);
  const [tab, setTab] = useState<"pending" | "critical">("pending");
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ResultFormData>({
    resolver: zodResolver(resultSchema),
    defaultValues: {
      interpretation: "normal",
    },
  });

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const loadData = async () => {
    try {
      setLoading(true);
      if (tab === "pending") {
        const orders = await getPendingLabOrders();
        setPendingOrders(orders);
      } else {
        const results = await getCriticalResults();
        setCriticalResults(results);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCollected = async (orderId: string) => {
    try {
      await updateLabOrderStatus(orderId, "collected");
      toast.push({
        id: Date.now().toString(),
        title: "Specimen marked as collected",
      });
      await loadData();
    } catch (error) {
      console.error("Failed to update status:", error);
      toast.push({
        id: Date.now().toString(),
        title: "Failed to update status",
      });
    }
  };

  const handleProcessing = async (orderId: string) => {
    try {
      await updateLabOrderStatus(orderId, "processing");
      toast.push({
        id: Date.now().toString(),
        title: "Test marked as processing",
      });
      await loadData();
    } catch (error) {
      console.error("Failed to update status:", error);
      toast.push({
        id: Date.now().toString(),
        title: "Failed to update status",
      });
    }
  };

  const handleAddResult = (order: LabOrder) => {
    setSelectedOrder(order);
    setShowResultForm(true);
  };

  const onSubmitResult = async (data: ResultFormData) => {
    if (!selectedOrder) return;

    try {
      await addLabResult({
        orderId: selectedOrder.id,
        resultValue: data.resultValue,
        resultUnit: data.resultUnit,
        referenceRange: data.referenceRange,
        interpretation: data.interpretation,
        resultDate: new Date(),
        notes: data.notes,
      });

      await updateLabOrderStatus(selectedOrder.id, "completed");

      toast.push({
        id: Date.now().toString(),
        title: "Lab result added successfully",
      });
      setShowResultForm(false);
      setSelectedOrder(null);
      reset();
      await loadData();
    } catch (error) {
      console.error("Failed to add result:", error);
      toast.push({ id: Date.now().toString(), title: "Failed to add result" });
    }
  };

  const handleReview = async (resultId: string) => {
    try {
      await reviewLabResult(resultId, userId);
      toast.push({
        id: Date.now().toString(),
        title: "Result marked as reviewed",
      });
      await loadData();
    } catch (error) {
      console.error("Failed to review result:", error);
      toast.push({
        id: Date.now().toString(),
        title: "Failed to review result",
      });
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "stat":
        return "text-red-600 bg-red-100";
      case "urgent":
        return "text-orange-600 bg-orange-100";
      default:
        return "text-blue-600 bg-blue-100";
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getInterpretationColor = (interpretation: string) => {
    switch (interpretation) {
      case "critical":
        return "text-red-600 bg-red-100";
      case "abnormal":
        return "text-yellow-600 bg-yellow-100";
      default:
        return "text-green-600 bg-green-100";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <BeakerIcon className="h-6 w-6 text-gray-400 mr-2" />
              <h3 className="text-lg font-medium text-gray-900">
                Laboratory Results
              </h3>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setTab("pending")}
                className={`px-3 py-2 text-sm font-medium rounded-md ${
                  tab === "pending"
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Pending Orders ({pendingOrders.length})
              </button>
              <button
                onClick={() => setTab("critical")}
                className={`px-3 py-2 text-sm font-medium rounded-md ${
                  tab === "critical"
                    ? "bg-red-100 text-red-700"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Critical Results ({criticalResults.length})
              </button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-200">
          {tab === "pending" ? (
            pendingOrders.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">
                No pending lab orders
              </div>
            ) : (
              pendingOrders.map((order) => (
                <div
                  key={order.id}
                  className="px-4 py-4 sm:px-6 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(
                            order.priority,
                          )}`}
                        >
                          {order.priority.toUpperCase()}
                        </span>
                        <span className="ml-3 text-sm font-medium text-gray-900">
                          {order.testName}
                        </span>
                        {order.testCode && (
                          <span className="ml-2 text-sm text-gray-500">
                            ({order.testCode})
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-gray-500">
                        Status:{" "}
                        <span className="font-medium">{order.status}</span>
                      </div>
                      <div className="mt-1 text-sm text-gray-500">
                        Ordered:{" "}
                        {order.orderedAt
                          ? new Date(order.orderedAt).toLocaleString()
                          : "N/A"}
                      </div>
                    </div>
                    <div className="flex flex-col space-y-2 ml-4">
                      {order.status === "ordered" && (
                        <button
                          onClick={() => handleCollected(order.id)}
                          className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200"
                        >
                          Mark Collected
                        </button>
                      )}
                      {order.status === "collected" && (
                        <button
                          onClick={() => handleProcessing(order.id)}
                          className="px-3 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-md hover:bg-purple-200"
                        >
                          Start Processing
                        </button>
                      )}
                      {order.status === "processing" && (
                        <button
                          onClick={() => handleAddResult(order)}
                          className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200"
                        >
                          Add Result
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )
          ) : criticalResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              No critical results pending review
            </div>
          ) : (
            criticalResults.map((result) => (
              <div
                key={result.id}
                className="px-4 py-4 sm:px-6 bg-red-50 border-l-4 border-red-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mr-2" />
                      <span className="text-sm font-medium text-gray-900">
                        CRITICAL RESULT
                      </span>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="font-medium">{result.testName}:</span>{" "}
                      {result.resultValue} {result.resultUnit}
                    </div>
                    {result.referenceRange && (
                      <div className="mt-1 text-sm text-gray-600">
                        Reference: {result.referenceRange}
                      </div>
                    )}
                    {result.notes && (
                      <div className="mt-1 text-sm text-gray-600">
                        Notes: {result.notes}
                      </div>
                    )}
                    <div className="mt-1 text-sm text-gray-500">
                      Result Date:{" "}
                      {result.resultDate
                        ? new Date(result.resultDate).toLocaleString()
                        : "N/A"}
                    </div>
                  </div>
                  {!result.reviewedBy && (
                    <button
                      onClick={() => handleReview(result.id)}
                      className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                    >
                      Mark Reviewed
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-3 bg-gray-50 text-right sm:px-6">
          <button
            onClick={loadData}
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {showResultForm && selectedOrder && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">
                  Enter Lab Result
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedOrder.testName}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowResultForm(false);
                  setSelectedOrder(null);
                  reset();
                }}
                className="text-gray-400 hover:text-gray-500"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit(onSubmitResult)}
              className="px-4 py-5 sm:p-6 space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Result Value *
                  </label>
                  <input
                    {...register("resultValue")}
                    type="text"
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="e.g., 12.5"
                  />
                  {errors.resultValue && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.resultValue.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Unit
                  </label>
                  <input
                    {...register("resultUnit")}
                    type="text"
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="e.g., g/dL, mg/dL"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Reference Range
                </label>
                <input
                  {...register("referenceRange")}
                  type="text"
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="e.g., 12-16 g/dL"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Interpretation *
                </label>
                <select
                  {...register("interpretation")}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="normal">Normal</option>
                  <option value="abnormal">Abnormal</option>
                  <option value="critical">Critical</option>
                </select>
                {errors.interpretation && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.interpretation.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Notes
                </label>
                <textarea
                  {...register("notes")}
                  rows={3}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Any additional notes or observations..."
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowResultForm(false);
                    setSelectedOrder(null);
                    reset();
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Submit Result
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
