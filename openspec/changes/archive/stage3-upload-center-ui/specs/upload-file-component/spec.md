## ADDED Requirements

### Requirement: Drag and drop file upload
The system SHALL provide a drag-and-drop zone for file upload. Users SHALL be able to drag files from their file system and drop them onto the zone to initiate upload. The zone SHALL also support click-to-browse for file selection. Multiple file selection SHALL be supported.

#### Scenario: Drag and drop single file
- **WHEN** user drags a PDF file onto the upload zone
- **THEN** the zone highlights with a visual indicator, and dropping the file initiates the upload

#### Scenario: Drag and drop multiple files
- **WHEN** user drags 3 files onto the upload zone
- **THEN** all 3 files are queued for upload and processed sequentially

#### Scenario: Click to browse
- **WHEN** user clicks on the upload zone
- **THEN** a native file picker dialog opens allowing file selection

### Requirement: Upload progress display
The system SHALL display upload progress for each file being uploaded. The progress indicator SHALL show: filename, file size, upload percentage, and estimated time remaining. Completed uploads SHALL show a success checkmark. Failed uploads SHALL show an error icon with a brief error message.

#### Scenario: Upload progress bar
- **WHEN** a 10MB file is being uploaded
- **THEN** a progress bar shows the upload percentage incrementing from 0% to 100%

#### Scenario: Upload complete
- **WHEN** file upload completes successfully
- **THEN** the progress indicator shows a green checkmark and the file appears in the upload list

#### Scenario: Upload error
- **WHEN** file upload fails (e.g., 413 too large)
- **THEN** the progress indicator shows a red error icon with the error message "文件超过 200MB 大小限制"

### Requirement: File type restriction display
The upload zone SHALL display the list of accepted file types. The zone SHALL show a hint text listing supported formats: PDF, DOCX, PPTX, XLSX, MD, TXT, RST, PNG, JPG, WEBP, ZIP. Files with unsupported extensions SHALL be rejected at the frontend with an error message before upload.

#### Scenario: Supported file type hint
- **WHEN** user views the upload zone
- **THEN** it displays "支持文件类型：PDF, DOCX, PPTX, XLSX, Markdown, TXT, 图片, ZIP"

#### Scenario: Unsupported file rejected at frontend
- **WHEN** user tries to upload a .exe file
- **THEN** the frontend shows an error "不支持的文件类型: .exe" without making an API request

### Requirement: File size limit display
The upload zone SHALL display the maximum file size limit (200MB). Files exceeding 200MB SHALL be rejected at the frontend before upload with a clear error message.

#### Scenario: File size limit hint
- **WHEN** user views the upload zone
- **THEN** it displays "单个文件最大 200MB"

#### Scenario: Oversized file rejected at frontend
- **WHEN** user selects a 250MB file
- **THEN** the frontend shows an error "文件大小 (250MB) 超过 200MB 限制" without making an API request
