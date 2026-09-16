using FluentValidation.TestHelper;
using UniDipVeri.Application.Features.AcademicRecords.Models;
using UniDipVeri.Application.Features.AcademicRecords.Validators;

namespace UniDipVeri.Application.Tests.Validators;

public class AcademicRecordValidatorsTests
{
    private readonly ImportAcademicRecordRequestValidator _validator = new();

    private static ImportAcademicRecordRequest CreateValidRequest() => new()
    {
        StudentNumber = "STU-2026-001",
        Name = "Alice Student",
        Email = "alice@student.miu.edu",
        ProgramId = Guid.NewGuid(),
        CreditsCompleted = 120,
        Gpa = 3.75m,
        CompletedCourses = ["CS101", "CS102"],
        SourceRecordRef = "SIS-001"
    };

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void ImportRecord_ShouldHaveError_WhenStudentNumberIsBlank(string? number)
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = number!,
            Name = "Alice",
            Email = "alice@miu.edu",
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = [],
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.StudentNumber);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void ImportRecord_ShouldHaveError_WhenNameIsBlank(string? name)
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = "STU-001",
            Name = name!,
            Email = "alice@miu.edu",
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = [],
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void ImportRecord_ShouldHaveError_WhenEmailIsBlank(string? email)
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = "STU-001",
            Name = "Alice",
            Email = email!,
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = [],
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Email);
    }

    [Theory]
    [InlineData("notanemail")]
    [InlineData("@nodomain.com")]
    [InlineData("user@")]
    public void ImportRecord_ShouldHaveError_WhenEmailFormatIsInvalid(string email)
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = "STU-001",
            Name = "Alice",
            Email = email,
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = [],
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Email)
            .WithErrorMessage("Invalid email format.");
    }

    [Fact]
    public void ImportRecord_ShouldHaveError_WhenProgramIdIsEmpty()
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = "STU-001",
            Name = "Alice",
            Email = "alice@miu.edu",
            ProgramId = Guid.Empty,
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = [],
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.ProgramId);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(-5)]
    public void ImportRecord_ShouldHaveError_WhenCreditsAreNegative(int credits)
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = "STU-001",
            Name = "Alice",
            Email = "alice@miu.edu",
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = credits,
            Gpa = 3.5m,
            CompletedCourses = [],
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(4.01)]
    [InlineData(5.0)]
    public void ImportRecord_ShouldHaveError_WhenGpaIsOutOfRange(decimal gpa)
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = "STU-001",
            Name = "Alice",
            Email = "alice@miu.edu",
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = gpa,
            CompletedCourses = [],
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Gpa);
    }

    [Fact]
    public void ImportRecord_ShouldHaveError_WhenCompletedCoursesIsNull()
    {
        var model = new ImportAcademicRecordRequest
        {
            StudentNumber = "STU-001",
            Name = "Alice",
            Email = "alice@miu.edu",
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = null!,
            SourceRecordRef = "REF1"
        };

        var result = _validator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.CompletedCourses);
    }

    [Fact]
    public void ImportRecord_ShouldPass_WhenRequestIsValid()
    {
        var model = CreateValidRequest();
        var result = _validator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }
}
