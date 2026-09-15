using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Features.AcademicRecords.Abstractions;
using UniDipVeri.Application.Features.AcademicRecords.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.AcademicRecords.Services;

public class AcademicRecordService(
    IAcademicRecordRepository academicRecordRepository,
    IStudentRepository studentRepository,
    IProgramRepository programRepository) : IAcademicRecordService
{
    private readonly IAcademicRecordRepository _academicRecordRepository = academicRecordRepository;
    private readonly IStudentRepository _studentRepository = studentRepository;
    private readonly IProgramRepository _programRepository = programRepository;

    public async Task<AcademicRecordResult<ImportResultResponse>> ImportRecordAsync(
        ImportAcademicRecordRequest request,
        CancellationToken ct = default)
    {
        if (request is null)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Request body cannot be null.");
        }

        if (string.IsNullOrWhiteSpace(request.StudentNumber))
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Student number is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Student name is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Student email is required.");
        }

        var trimmedEmail = request.Email.Trim().ToLowerInvariant();
        if (!System.Net.Mail.MailAddress.TryCreate(trimmedEmail, out var mailAddress) || mailAddress.Address != trimmedEmail)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Invalid email format.");
        }

        if (string.IsNullOrWhiteSpace(request.SourceRecordRef))
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Source record reference is required.");
        }

        if (request.ProgramId == Guid.Empty)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Program ID cannot be empty.");
        }

        var effectiveCredits = request.GetEffectiveCredits();
        if (effectiveCredits < 0)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Credits completed cannot be negative or must be provided.");
        }

        if (request.Gpa < 0.0m || request.Gpa > 4.0m)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("GPA must be between 0.0 and 4.0.");
        }

        if (request.CompletedCourses is null)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Completed courses cannot be null.");
        }

        // Validate program
        var program = await _programRepository.GetByIdAsync(request.ProgramId, ct);
        if (program is null)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Referenced program was not found.");
        }

        if (program.Status != ProgramStatus.ACTIVE)
        {
            return AcademicRecordResult<ImportResultResponse>.Validation("Referenced program is not active.");
        }

        var trimmedStudentNumber = request.StudentNumber.Trim();
        var trimmedSourceRef = request.SourceRecordRef.Trim();
        var snapshotAt = request.SourceSnapshotAt ?? DateTime.UtcNow;

        // Check if student exists by SourceRecordRef
        var existingStudent = await _studentRepository.GetBySourceRecordRefAsync(trimmedSourceRef, ct);

        if (existingStudent is not null)
        {
            // Identity checks: cannot change student number or program
            if (!string.Equals(existingStudent.StudentNumber, trimmedStudentNumber, StringComparison.OrdinalIgnoreCase))
            {
                return AcademicRecordResult<ImportResultResponse>.Conflict(
                    $"Student number '{trimmedStudentNumber}' does not match existing record for reference '{trimmedSourceRef}'.");
            }

            if (existingStudent.ProgramId != request.ProgramId)
            {
                return AcademicRecordResult<ImportResultResponse>.Conflict(
                    $"Program ID '{request.ProgramId}' does not match existing record for reference '{trimmedSourceRef}'.");
            }

            // Check email uniqueness if email has changed
            if (!string.Equals(existingStudent.Email, trimmedEmail, StringComparison.OrdinalIgnoreCase))
            {
                var emailOwner = await _studentRepository.GetByEmailAsync(trimmedEmail, ct);
                if (emailOwner is not null && emailOwner.Id != existingStudent.Id)
                {
                    return AcademicRecordResult<ImportResultResponse>.Conflict(
                        $"Email '{trimmedEmail}' is already registered to another student.");
                }
            }

            // Update student demographic info
            existingStudent.UpdateProfile(request.Name, trimmedEmail);
            await _studentRepository.UpdateAsync(existingStudent, ct);

            // Update or create AcademicRecord
            var record = await _academicRecordRepository.GetByStudentIdAsync(existingStudent.Id, ct);
            if (record is not null)
            {
                record.UpdateRecord(effectiveCredits, request.Gpa, request.CompletedCourses, snapshotAt);
                await _academicRecordRepository.UpdateAsync(record, ct);
            }
            else
            {
                record = AcademicRecord.Create(
                    existingStudent.Id,
                    effectiveCredits,
                    request.Gpa,
                    request.CompletedCourses,
                    snapshotAt);
                await _academicRecordRepository.AddAsync(record, ct);
            }

            return AcademicRecordResult<ImportResultResponse>.Success(new ImportResultResponse
            {
                StudentId = existingStudent.Id,
                StudentNumber = existingStudent.StudentNumber,
                Name = existingStudent.Name,
                Email = existingStudent.Email,
                AccountStatus = existingStudent.AccountStatus.ToString(),
                WalletStatus = existingStudent.WalletStatus.ToString(),
                IsNewStudent = false,
                AcademicRecord = AcademicRecordResponse.FromEntity(record)
            });
        }

        // New Student: verify email and student number are not already taken
        var studentByNumber = await _studentRepository.GetByStudentNumberAsync(trimmedStudentNumber, ct);
        if (studentByNumber is not null)
        {
            return AcademicRecordResult<ImportResultResponse>.Conflict(
                $"Student number '{trimmedStudentNumber}' is already registered.");
        }

        var studentByEmail = await _studentRepository.GetByEmailAsync(trimmedEmail, ct);
        if (studentByEmail is not null)
        {
            return AcademicRecordResult<ImportResultResponse>.Conflict(
                $"Email '{trimmedEmail}' is already registered.");
        }

        var newStudent = Student.Create(
            request.ProgramId,
            trimmedStudentNumber,
            request.Name,
            trimmedEmail,
            trimmedSourceRef);

        await _studentRepository.AddAsync(newStudent, ct);

        var newRecord = AcademicRecord.Create(
            newStudent.Id,
            effectiveCredits,
            request.Gpa,
            request.CompletedCourses,
            snapshotAt);

        await _academicRecordRepository.AddAsync(newRecord, ct);

        return AcademicRecordResult<ImportResultResponse>.Success(new ImportResultResponse
        {
            StudentId = newStudent.Id,
            StudentNumber = newStudent.StudentNumber,
            Name = newStudent.Name,
            Email = newStudent.Email,
            AccountStatus = newStudent.AccountStatus.ToString(),
            WalletStatus = newStudent.WalletStatus.ToString(),
            IsNewStudent = true,
            AcademicRecord = AcademicRecordResponse.FromEntity(newRecord)
        });
    }

    public async Task<AcademicRecordResult<AcademicRecordResponse>> GetRecordByStudentIdAsync(
        Guid studentId,
        CancellationToken ct = default)
    {
        if (studentId == Guid.Empty)
        {
            return AcademicRecordResult<AcademicRecordResponse>.Validation("Student ID cannot be empty.");
        }

        var student = await _studentRepository.GetByIdAsync(studentId, ct);
        if (student is null)
        {
            return AcademicRecordResult<AcademicRecordResponse>.NotFound(
                $"Student with ID '{studentId}' was not found.");
        }

        var record = await _academicRecordRepository.GetByStudentIdAsync(studentId, ct);
        if (record is null)
        {
            return AcademicRecordResult<AcademicRecordResponse>.NotFound(
                $"Academic record for student '{studentId}' was not found.");
        }

        return AcademicRecordResult<AcademicRecordResponse>.Success(AcademicRecordResponse.FromEntity(record));
    }
}
