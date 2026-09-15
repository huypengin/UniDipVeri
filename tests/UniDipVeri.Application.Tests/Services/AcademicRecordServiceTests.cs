using FluentAssertions;
using Moq;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Features.AcademicRecords.Models;
using UniDipVeri.Application.Features.AcademicRecords.Services;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Tests.Services;

public class AcademicRecordServiceTests
{
    private readonly Mock<IAcademicRecordRepository> _recordRepoMock = new();
    private readonly Mock<IStudentRepository> _studentRepoMock = new();
    private readonly Mock<IProgramRepository> _programRepoMock = new();
    private readonly AcademicRecordService _service;

    private readonly Guid _programId = Guid.NewGuid();
    private readonly Guid _universityId = Guid.NewGuid();

    public AcademicRecordServiceTests()
    {
        _service = new AcademicRecordService(
            _recordRepoMock.Object,
            _studentRepoMock.Object,
            _programRepoMock.Object);

        var program = Program.Create(
            _universityId,
            "Computer Science",
            "Bachelor of Science in Computer Science",
            DegreeLevel.BACHELOR,
            id: _programId);

        _programRepoMock.Setup(r => r.GetByIdAsync(_programId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(program);
    }

    #region Validation Tests

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenRequestIsNull()
    {
        var result = await _service.ImportRecordAsync(null!);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("null");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenStudentNumberIsBlank(string number)
    {
        var request = CreateValidRequest() with { StudentNumber = number };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("Student number is required");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenNameIsBlank(string name)
    {
        var request = CreateValidRequest() with { Name = name };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("name is required");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenEmailIsBlank(string email)
    {
        var request = CreateValidRequest() with { Email = email };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("email is required");
    }

    [Theory]
    [InlineData("invalid-email")]
    [InlineData("test@")]
    [InlineData("@domain.com")]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenEmailFormatIsInvalid(string email)
    {
        var request = CreateValidRequest() with { Email = email };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("email format");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenSourceRefIsBlank(string sourceRef)
    {
        var request = CreateValidRequest() with { SourceRecordRef = sourceRef };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("Source record reference is required");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenProgramIdIsEmpty()
    {
        var request = CreateValidRequest() with { ProgramId = Guid.Empty };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("Program ID");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenCreditsNegative()
    {
        var request = CreateValidRequest() with { CreditsCompleted = -1 };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("Credits completed");
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(4.1)]
    [InlineData(5.0)]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenGpaOutOfRange(decimal gpa)
    {
        var request = CreateValidRequest() with { Gpa = gpa };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("GPA");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenCompletedCoursesIsNull()
    {
        var request = CreateValidRequest() with { CompletedCourses = null };

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("Completed courses");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenProgramNotFound()
    {
        _programRepoMock.Setup(r => r.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Program?)null);

        var request = CreateValidRequest();

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("Referenced program was not found");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnValidation_WhenProgramIsInactive()
    {
        var inactiveProgram = Program.Create(
            _universityId,
            "History",
            "Bachelor of Arts in History",
            DegreeLevel.BACHELOR,
            id: _programId);
        inactiveProgram.Deactivate();

        _programRepoMock.Setup(r => r.GetByIdAsync(_programId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inactiveProgram);

        var request = CreateValidRequest();

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
        result.Error.Should().Contain("Referenced program is not active");
    }

    #endregion

    #region New Student Import Tests

    [Fact]
    public async Task ImportRecordAsync_ShouldCreateNewStudentAndRecord_WhenStudentDoesNotExist()
    {
        var request = CreateValidRequest();

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);
        _studentRepoMock.Setup(r => r.GetByStudentNumberAsync(request.StudentNumber, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);
        _studentRepoMock.Setup(r => r.GetByEmailAsync(request.Email.ToLowerInvariant(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.IsNewStudent.Should().BeTrue();
        result.Data.StudentNumber.Should().Be(request.StudentNumber);
        result.Data.Name.Should().Be(request.Name);
        result.Data.Email.Should().Be(request.Email.ToLowerInvariant());
        result.Data.AccountStatus.Should().Be("PENDING_ACTIVATION");
        result.Data.WalletStatus.Should().Be("PENDING");
        result.Data.AcademicRecord.CreditsCompleted.Should().Be(120);
        result.Data.AcademicRecord.Gpa.Should().Be(3.8m);
        result.Data.AcademicRecord.CompletedCourses.Should().Equal("CS101", "CS102");

        _studentRepoMock.Verify(r => r.AddAsync(It.Is<Student>(s =>
            s.StudentNumber == request.StudentNumber &&
            s.SourceRecordRef == request.SourceRecordRef), It.IsAny<CancellationToken>()), Times.Once);

        _recordRepoMock.Verify(r => r.AddAsync(It.Is<AcademicRecord>(ar =>
            ar.CreditsCompleted == 120 &&
            ar.Gpa == 3.8m), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldSupportCreditsAlias_WhenCreditsCompletedIsNull()
    {
        var request = new ImportAcademicRecordRequest
        {
            StudentNumber = "MIU2026-001",
            Name = "John Doe",
            Email = "john@example.com",
            ProgramId = _programId,
            Credits = 130, // Using alias
            Gpa = 3.5m,
            CompletedCourses = ["CS101"],
            SourceRecordRef = "SRC-001"
        };

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeTrue();
        result.Data!.AcademicRecord.CreditsCompleted.Should().Be(130);
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnConflict_WhenNewStudentNumberAlreadyExists()
    {
        var request = CreateValidRequest();
        var existingStudent = Student.Create(
            _programId, request.StudentNumber, "Existing Name", "existing@test.com", "OTHER-REF");

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);
        _studentRepoMock.Setup(r => r.GetByStudentNumberAsync(request.StudentNumber, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingStudent);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Conflict);
        result.Error.Should().Contain("already registered");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnConflict_WhenNewStudentEmailAlreadyExists()
    {
        var request = CreateValidRequest();
        var existingStudent = Student.Create(
            _programId, "OTHER-NUM", "Existing Name", request.Email, "OTHER-REF");

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);
        _studentRepoMock.Setup(r => r.GetByStudentNumberAsync(request.StudentNumber, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);
        _studentRepoMock.Setup(r => r.GetByEmailAsync(request.Email.ToLowerInvariant(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingStudent);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Conflict);
        result.Error.Should().Contain("already registered");
    }

    #endregion

    #region Existing Student Update Tests

    [Fact]
    public async Task ImportRecordAsync_ShouldUpdateExistingStudentAndRecord()
    {
        var request = CreateValidRequest();
        var student = Student.Create(
            _programId,
            request.StudentNumber,
            "Old Name",
            "old@example.com",
            request.SourceRecordRef);
        student.ActivateAccount();

        var existingRecord = AcademicRecord.Create(
            student.Id, 60, 3.0m, ["CS100"], DateTime.UtcNow.AddDays(-30));

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);
        _studentRepoMock.Setup(r => r.GetByEmailAsync(request.Email.ToLowerInvariant(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);
        _recordRepoMock.Setup(r => r.GetByStudentIdAsync(student.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingRecord);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeTrue();
        result.Data!.IsNewStudent.Should().BeFalse();
        result.Data.Name.Should().Be(request.Name);
        result.Data.Email.Should().Be(request.Email.ToLowerInvariant());
        result.Data.AccountStatus.Should().Be("ACTIVE");
        result.Data.AcademicRecord.CreditsCompleted.Should().Be(120);
        result.Data.AcademicRecord.Gpa.Should().Be(3.8m);
        result.Data.AcademicRecord.CompletedCourses.Should().Equal("CS101", "CS102");

        _studentRepoMock.Verify(r => r.UpdateAsync(student, It.IsAny<CancellationToken>()), Times.Once);
        _recordRepoMock.Verify(r => r.UpdateAsync(existingRecord, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnConflict_WhenExistingStudentNumberMismatches()
    {
        var request = CreateValidRequest() with { StudentNumber = "MISMATCHED-NUM" };
        var student = Student.Create(
            _programId,
            "ORIGINAL-NUM",
            "Old Name",
            "old@example.com",
            request.SourceRecordRef);

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Conflict);
        result.Error.Should().Contain("does not match existing record");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnConflict_WhenExistingProgramIdMismatches()
    {
        var otherProgramId = Guid.NewGuid();
        var request = CreateValidRequest() with { ProgramId = otherProgramId };

        var otherProgram = Program.Create(
            _universityId, "Other", "Master of Other", DegreeLevel.MASTER, id: otherProgramId);
        _programRepoMock.Setup(r => r.GetByIdAsync(otherProgramId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(otherProgram);

        var student = Student.Create(
            _programId,
            request.StudentNumber,
            "Old Name",
            "old@example.com",
            request.SourceRecordRef);

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Conflict);
        result.Error.Should().Contain("Program ID");
    }

    [Fact]
    public async Task ImportRecordAsync_ShouldReturnConflict_WhenUpdatedEmailBelongsToAnotherStudent()
    {
        var request = CreateValidRequest();
        var student = Student.Create(
            _programId,
            request.StudentNumber,
            "Old Name",
            "old@example.com",
            request.SourceRecordRef);

        var anotherStudent = Student.Create(
            _programId,
            "ANOTHER-NUM",
            "Another Name",
            request.Email,
            "OTHER-REF");

        _studentRepoMock.Setup(r => r.GetBySourceRecordRefAsync(request.SourceRecordRef, It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);
        _studentRepoMock.Setup(r => r.GetByEmailAsync(request.Email.ToLowerInvariant(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(anotherStudent);

        var result = await _service.ImportRecordAsync(request);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Conflict);
        result.Error.Should().Contain("already registered to another student");
    }

    #endregion

    #region GetRecordByStudentIdAsync Tests

    [Fact]
    public async Task GetRecordByStudentIdAsync_ShouldReturnValidation_WhenStudentIdIsEmpty()
    {
        var result = await _service.GetRecordByStudentIdAsync(Guid.Empty);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.Validation);
    }

    [Fact]
    public async Task GetRecordByStudentIdAsync_ShouldReturnNotFound_WhenStudentDoesNotExist()
    {
        var studentId = Guid.NewGuid();
        _studentRepoMock.Setup(r => r.GetByIdAsync(studentId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);

        var result = await _service.GetRecordByStudentIdAsync(studentId);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.NotFound);
        result.Error.Should().Contain("Student with ID");
    }

    [Fact]
    public async Task GetRecordByStudentIdAsync_ShouldReturnNotFound_WhenRecordDoesNotExist()
    {
        var student = Student.Create(
            _programId, "NUM-1", "Name", "email@test.com", "REF-1");
        _studentRepoMock.Setup(r => r.GetByIdAsync(student.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);
        _recordRepoMock.Setup(r => r.GetByStudentIdAsync(student.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((AcademicRecord?)null);

        var result = await _service.GetRecordByStudentIdAsync(student.Id);

        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(AcademicRecordErrorType.NotFound);
        result.Error.Should().Contain("Academic record for student");
    }

    [Fact]
    public async Task GetRecordByStudentIdAsync_ShouldReturnRecord_WhenFound()
    {
        var student = Student.Create(
            _programId, "NUM-1", "Name", "email@test.com", "REF-1");
        var record = AcademicRecord.Create(
            student.Id, 120, 3.9m, ["CS101", "CS102"], DateTime.UtcNow);

        _studentRepoMock.Setup(r => r.GetByIdAsync(student.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);
        _recordRepoMock.Setup(r => r.GetByStudentIdAsync(student.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(record);

        var result = await _service.GetRecordByStudentIdAsync(student.Id);

        result.IsSuccess.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.CreditsCompleted.Should().Be(120);
        result.Data.Gpa.Should().Be(3.9m);
        result.Data.CompletedCourses.Should().Equal("CS101", "CS102");
    }

    #endregion

    private ImportAcademicRecordRequest CreateValidRequest() => new()
    {
        StudentNumber = "MIU2026-001",
        Name = "Nguyen Minh Anh",
        Email = "anh.nguyen@student.miu.example",
        ProgramId = _programId,
        CreditsCompleted = 120,
        Gpa = 3.8m,
        CompletedCourses = ["CS101", "CS102"],
        SourceRecordRef = "SIS-REG-2026-001",
        SourceSnapshotAt = DateTime.UtcNow
    };
}
