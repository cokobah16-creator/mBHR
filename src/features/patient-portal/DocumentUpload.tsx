import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  DocumentArrowUpIcon,
  DocumentTextIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface Document {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  document_type: string;
  upload_date: string;
  description?: string;
}

export function DocumentUpload() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploadData, setUploadData] = useState({
    documentType: "medical_record",
    description: "",
  });

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDocuments = async () => {
    setLoading(true);
    setError("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const portalUser = JSON.parse(portalUserStr);

      const { data, error: docsError } = await supabase
        .from("patient_documents")
        .select("*")
        .eq("patient_id", portalUser.patientId)
        .order("upload_date", { ascending: false });

      if (docsError) throw docsError;

      setDocuments(data || []);
    } catch (err) {
      logger.error("Error loading documents:", err);
      setError("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB");
      return;
    }

    setUploading(true);
    setError("");
    setSuccess("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const portalUser = JSON.parse(portalUserStr);

      const fileExt = file.name.split(".").pop();
      const fileName = `${portalUser.patientId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("patient-documents")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from("patient_documents")
        .insert({
          patient_id: portalUser.patientId,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          document_type: uploadData.documentType,
          description: uploadData.description || null,
          storage_path: fileName,
        });

      if (insertError) throw insertError;

      setSuccess("Document uploaded successfully");
      setUploadData({ documentType: "medical_record", description: "" });
      await loadDocuments();
    } catch (err) {
      logger.error("Error uploading document:", err);
      setError("Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (doc: Document) => {
    if (!confirm(`Delete ${doc.file_name}?`)) return;

    try {
      const { error: deleteError } = await supabase
        .from("patient_documents")
        .delete()
        .eq("id", doc.id);

      if (deleteError) throw deleteError;

      setSuccess("Document deleted successfully");
      await loadDocuments();
    } catch (err) {
      logger.error("Error deleting document:", err);
      setError("Failed to delete document");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading documents...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Document Upload</h1>
          <p className="mt-2 text-gray-600">
            Upload and manage your medical documents
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Upload New Document</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Document Type
              </label>
              <select
                value={uploadData.documentType}
                onChange={(e) =>
                  setUploadData({ ...uploadData, documentType: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="medical_record">Medical Record</option>
                <option value="lab_result">Lab Result</option>
                <option value="imaging">Imaging/X-Ray</option>
                <option value="prescription">Prescription</option>
                <option value="insurance">Insurance Document</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (Optional)
              </label>
              <input
                type="text"
                value={uploadData.description}
                onChange={(e) =>
                  setUploadData({ ...uploadData, description: e.target.value })
                }
                placeholder="Brief description of the document"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select File (Max 10MB)
              </label>
              <input
                type="file"
                onChange={handleFileUpload}
                disabled={uploading}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-gray-500">
                Accepted formats: PDF, JPG, PNG, DOC, DOCX
              </p>
            </div>

            {uploading && (
              <div className="flex items-center gap-2 text-blue-600">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                <span>Uploading...</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {documents.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentArrowUpIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No documents uploaded
              </h3>
              <p className="text-gray-600">
                Your uploaded documents will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 flex items-center justify-between hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <DocumentTextIcon className="h-10 w-10 text-gray-400" />
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {doc.file_name}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-600">
                        <span className="capitalize">
                          {doc.document_type.replace("_", " ")}
                        </span>
                        <span>{formatFileSize(doc.file_size)}</span>
                        <span>{formatNigerianDate(doc.upload_date)}</span>
                      </div>
                      {doc.description && (
                        <p className="text-sm text-gray-600 mt-1">
                          {doc.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteDocument(doc)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
