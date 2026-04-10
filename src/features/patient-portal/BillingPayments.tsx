import { useEffect, useState } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  CreditCardIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  BanknotesIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";

interface Bill {
  id: string;
  visitId: string;
  visitDate: Date;
  description: string;
  amount: number;
  amountPaid: number;
  status: "pending" | "partial" | "paid" | "overdue";
  dueDate: Date;
  createdAt: Date;
}

interface Payment {
  id: string;
  billId: string;
  amount: number;
  paymentMethod: "cash" | "card" | "bank_transfer" | "mobile_money";
  referenceNumber: string;
  paidAt: Date;
  status: "completed" | "pending" | "failed";
}

export function BillingPayments() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("card");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadBillingData();
  }, []);

  const loadBillingData = async () => {
    setLoading(true);
    try {
      const portalUser = JSON.parse(
        localStorage.getItem("patient_portal_user") || "{}",
      );
      if (!portalUser.patientId) {
        logger.error("No patient ID found");
        return;
      }

      // Mock data - replace with actual API calls
      const mockBills: Bill[] = [
        {
          id: "1",
          visitId: "visit-1",
          visitDate: new Date("2025-10-15"),
          description: "General Consultation + Lab Tests",
          amount: 15000,
          amountPaid: 5000,
          status: "partial",
          dueDate: new Date("2025-11-15"),
          createdAt: new Date("2025-10-15"),
        },
        {
          id: "2",
          visitId: "visit-2",
          visitDate: new Date("2025-09-20"),
          description: "Follow-up Visit + Medications",
          amount: 8500,
          amountPaid: 8500,
          status: "paid",
          dueDate: new Date("2025-10-20"),
          createdAt: new Date("2025-09-20"),
        },
      ];

      const mockPayments: Payment[] = [
        {
          id: "pay-1",
          billId: "1",
          amount: 5000,
          paymentMethod: "card",
          referenceNumber: "PAY-2025-001",
          paidAt: new Date("2025-10-16"),
          status: "completed",
        },
      ];

      setBills(mockBills);
      setPayments(mockPayments);
    } catch (err) {
      logger.error("Error loading billing data:", err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: Bill["status"]) => {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-800";
      case "partial":
        return "bg-yellow-100 text-yellow-800";
      case "pending":
        return "bg-blue-100 text-blue-800";
      case "overdue":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: Bill["status"]) => {
    switch (status) {
      case "paid":
        return <CheckCircleIcon className="w-5 h-5" />;
      case "overdue":
        return <ExclamationCircleIcon className="w-5 h-5" />;
      default:
        return <ClockIcon className="w-5 h-5" />;
    }
  };

  const handlePayNow = (bill: Bill) => {
    setSelectedBill(bill);
    const remainingAmount = bill.amount - bill.amountPaid;
    setPaymentAmount(remainingAmount.toString());
    setShowPaymentModal(true);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBill) return;

    setProcessing(true);
    try {
      // Mock payment processing - replace with actual payment gateway integration
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Update bill status
      const updatedBills = bills.map((bill) => {
        if (bill.id === selectedBill.id) {
          const newAmountPaid = bill.amountPaid + parseFloat(paymentAmount);
          return {
            ...bill,
            amountPaid: newAmountPaid,
            status:
              newAmountPaid >= bill.amount
                ? ("paid" as const)
                : ("partial" as const),
          };
        }
        return bill;
      });

      setBills(updatedBills);
      setShowPaymentModal(false);
      setSelectedBill(null);
      setPaymentAmount("");

      alert("Payment successful!");
    } catch (err) {
      logger.error("Payment error:", err);
      alert("Payment failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadReceipt = (billId: string) => {
    logger.info("Downloading receipt for bill:", billId);
    alert("Receipt download will be implemented with PDF generation");
  };

  const totalOutstanding = bills.reduce(
    (sum, bill) => sum + (bill.amount - bill.amountPaid),
    0,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h1 className="text-3xl font-bold text-gray-900">Bills & Payments</h1>
        <p className="text-gray-600 mt-2">View and manage your medical bills</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <BanknotesIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Outstanding</p>
              <p className="text-2xl font-bold text-gray-900">
                ₦{totalOutstanding.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircleIcon className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Paid Bills</p>
              <p className="text-2xl font-bold text-gray-900">
                {bills.filter((b) => b.status === "paid").length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <DocumentTextIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Pending Bills</p>
              <p className="text-2xl font-bold text-gray-900">
                {bills.filter((b) => b.status !== "paid").length}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Recent Bills</h2>
        </div>

        <div className="divide-y divide-gray-200">
          {bills.map((bill) => (
            <div
              key={bill.id}
              className="p-6 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {getStatusIcon(bill.status)}
                    <h3 className="font-semibold text-gray-900">
                      {bill.description}
                    </h3>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(bill.status)}`}
                    >
                      {bill.status.charAt(0).toUpperCase() +
                        bill.status.slice(1)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600 mt-3">
                    <div>
                      <p className="font-medium text-gray-500">Visit Date</p>
                      <p>{formatNigerianDate(bill.visitDate)}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500">Total Amount</p>
                      <p className="font-semibold text-gray-900">
                        ₦{bill.amount.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500">Amount Paid</p>
                      <p className="font-semibold text-green-600">
                        ₦{bill.amountPaid.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500">Balance</p>
                      <p className="font-semibold text-red-600">
                        ₦{(bill.amount - bill.amountPaid).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 mt-4">
                    {bill.status !== "paid" && (
                      <button
                        onClick={() => handlePayNow(bill)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        Pay Now
                      </button>
                    )}
                    <button
                      onClick={() => handleDownloadReceipt(bill.id)}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center gap-2"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" />
                      Download Receipt
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showPaymentModal && selectedBill && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Make Payment
            </h2>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-600">Bill Description</p>
              <p className="font-semibold text-gray-900">
                {selectedBill.description}
              </p>
              <p className="text-sm text-gray-600 mt-2">Amount Due</p>
              <p className="text-2xl font-bold text-gray-900">
                ₦
                {(
                  selectedBill.amount - selectedBill.amountPaid
                ).toLocaleString()}
              </p>
            </div>

            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Amount (₦)
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  min="1"
                  max={selectedBill.amount - selectedBill.amountPaid}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="card">Debit/Credit Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="cash">Cash (Pay at Facility)</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowPaymentModal(false);
                    setSelectedBill(null);
                  }}
                  disabled={processing}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CreditCardIcon className="w-5 h-5" />
                      Pay Now
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
