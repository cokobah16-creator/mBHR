import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { formatNigerianDate } from '@/utils/dateFormat';
import { DocumentArrowUpIcon, DocumentTextIcon, TrashIcon } from '@heroicons/react/24/outline';
export function DocumentUpload() {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [uploadData, setUploadData] = useState({
        documentType: 'medical_record',
        description: ''
    });
    useEffect(() => {
        loadDocuments();
    }, []);
    const loadDocuments = async () => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            const { data, error: docsError } = await supabase
                .from('patient_documents')
                .select('*')
                .eq('patient_id', portalUser.patientId)
                .order('upload_date', { ascending: false });
            if (docsError)
                throw docsError;
            setDocuments(data || []);
        }
        catch (err) {
            logger.error('Error loading documents:', err);
            setError('Failed to load documents');
        }
        finally {
            setLoading(false);
        }
    };
    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        if (file.size > 10 * 1024 * 1024) {
            setError('File size must be less than 10MB');
            return;
        }
        setUploading(true);
        setError('');
        setSuccess('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            const fileExt = file.name.split('.').pop();
            const fileName = `${portalUser.patientId}/${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('patient-documents')
                .upload(fileName, file);
            if (uploadError)
                throw uploadError;
            const { error: insertError } = await supabase
                .from('patient_documents')
                .insert({
                patient_id: portalUser.patientId,
                file_name: file.name,
                file_type: file.type,
                file_size: file.size,
                document_type: uploadData.documentType,
                description: uploadData.description || null,
                storage_path: fileName
            });
            if (insertError)
                throw insertError;
            setSuccess('Document uploaded successfully');
            setUploadData({ documentType: 'medical_record', description: '' });
            await loadDocuments();
        }
        catch (err) {
            logger.error('Error uploading document:', err);
            setError('Failed to upload document');
        }
        finally {
            setUploading(false);
        }
    };
    const deleteDocument = async (doc) => {
        if (!confirm(`Delete ${doc.file_name}?`))
            return;
        try {
            const { error: deleteError } = await supabase
                .from('patient_documents')
                .delete()
                .eq('id', doc.id);
            if (deleteError)
                throw deleteError;
            setSuccess('Document deleted successfully');
            await loadDocuments();
        }
        catch (err) {
            logger.error('Error deleting document:', err);
            setError('Failed to delete document');
        }
    };
    const formatFileSize = (bytes) => {
        if (bytes < 1024)
            return bytes + ' B';
        if (bytes < 1024 * 1024)
            return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading documents..." })] }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsxs("div", { className: "max-w-4xl mx-auto", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Document Upload" }), _jsx("p", { className: "mt-2 text-gray-600", children: "Upload and manage your medical documents" })] }), error && (_jsx("div", { className: "mb-4 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), success && (_jsx("div", { className: "mb-4 p-4 bg-green-50 border border-green-200 rounded-lg", children: _jsx("p", { className: "text-sm text-green-800", children: success }) })), _jsxs("div", { className: "mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6", children: [_jsx("h2", { className: "text-lg font-semibold mb-4", children: "Upload New Document" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Document Type" }), _jsxs("select", { value: uploadData.documentType, onChange: (e) => setUploadData({ ...uploadData, documentType: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "medical_record", children: "Medical Record" }), _jsx("option", { value: "lab_result", children: "Lab Result" }), _jsx("option", { value: "imaging", children: "Imaging/X-Ray" }), _jsx("option", { value: "prescription", children: "Prescription" }), _jsx("option", { value: "insurance", children: "Insurance Document" }), _jsx("option", { value: "other", children: "Other" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Description (Optional)" }), _jsx("input", { type: "text", value: uploadData.description, onChange: (e) => setUploadData({ ...uploadData, description: e.target.value }), placeholder: "Brief description of the document", className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Select File (Max 10MB)" }), _jsx("input", { type: "file", onChange: handleFileUpload, disabled: uploading, accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx", className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50" }), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "Accepted formats: PDF, JPG, PNG, DOC, DOCX" })] }), uploading && (_jsxs("div", { className: "flex items-center gap-2 text-blue-600", children: [_jsx("div", { className: "animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" }), _jsx("span", { children: "Uploading..." })] }))] })] }), _jsx("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200", children: documents.length === 0 ? (_jsxs("div", { className: "p-12 text-center", children: [_jsx(DocumentArrowUpIcon, { className: "h-16 w-16 text-gray-400 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "No documents uploaded" }), _jsx("p", { className: "text-gray-600", children: "Your uploaded documents will appear here" })] })) : (_jsx("div", { className: "divide-y divide-gray-200", children: documents.map((doc) => (_jsxs("div", { className: "p-4 flex items-center justify-between hover:bg-gray-50", children: [_jsxs("div", { className: "flex items-center gap-3 flex-1", children: [_jsx(DocumentTextIcon, { className: "h-10 w-10 text-gray-400" }), _jsxs("div", { children: [_jsx("h3", { className: "font-medium text-gray-900", children: doc.file_name }), _jsxs("div", { className: "flex items-center gap-3 mt-1 text-sm text-gray-600", children: [_jsx("span", { className: "capitalize", children: doc.document_type.replace('_', ' ') }), _jsx("span", { children: formatFileSize(doc.file_size) }), _jsx("span", { children: formatNigerianDate(doc.upload_date) })] }), doc.description && (_jsx("p", { className: "text-sm text-gray-600 mt-1", children: doc.description }))] })] }), _jsx("button", { onClick: () => deleteDocument(doc), className: "p-2 text-red-600 hover:bg-red-50 rounded-md", children: _jsx(TrashIcon, { className: "h-5 w-5" }) })] }, doc.id))) })) })] }) }));
}
