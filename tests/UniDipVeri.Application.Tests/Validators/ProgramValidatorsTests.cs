using FluentValidation.TestHelper;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Application.Features.Programs.Validators;

namespace UniDipVeri.Application.Tests.Validators;

public class ProgramValidatorsTests
{
    private readonly CreateProgramRequestValidator _createValidator = new();
    private readonly UpdateProgramRequestValidator _updateValidator = new();

    #region CreateProgramRequestValidator Tests

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void CreateProgram_ShouldHaveError_WhenNameIsMissingOrWhitespace(string? name)
    {
        var model = new CreateProgramRequest
        {
            Name = name!,
            FullTitle = "Bachelor of Science in Computer Science",
            DegreeLevel = "BACHELOR"
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void CreateProgram_ShouldHaveError_WhenFullTitleIsMissingOrWhitespace(string? fullTitle)
    {
        var model = new CreateProgramRequest
        {
            Name = "Computer Science",
            FullTitle = fullTitle!,
            DegreeLevel = "BACHELOR"
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.FullTitle);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("INVALID_DEGREE")]
    public void CreateProgram_ShouldHaveError_WhenDegreeLevelIsInvalid(string degreeLevel)
    {
        var model = new CreateProgramRequest
        {
            Name = "Computer Science",
            FullTitle = "Bachelor of Science in Computer Science",
            DegreeLevel = degreeLevel
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.DegreeLevel);
    }

    [Theory]
    [InlineData("BACHELOR", "Master of Science in Computer Science")]
    [InlineData("MASTER", "Bachelor of Engineering")]
    [InlineData("DOCTORATE", "Bachelor of Arts in Philosophy")]
    public void CreateProgram_ShouldHaveError_WhenKeywordMismatchesDegreeLevel(string degreeLevel, string fullTitle)
    {
        var model = new CreateProgramRequest
        {
            Name = "Program",
            FullTitle = fullTitle,
            DegreeLevel = degreeLevel
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x)
            .WithErrorMessage($"The degree name '{fullTitle}' is invalid or does not match the degree level '{degreeLevel}'.");
    }

    [Fact]
    public void CreateProgram_ShouldPass_WhenRequestIsValid()
    {
        var model = new CreateProgramRequest
        {
            Name = "Computer Science",
            FullTitle = "Bachelor of Science in Computer Science",
            DegreeLevel = "BACHELOR"
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion

    #region UpdateProgramRequestValidator Tests

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void UpdateProgram_ShouldHaveError_WhenNameIsBlank(string name)
    {
        var model = new UpdateProgramRequest { Name = name };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void UpdateProgram_ShouldHaveError_WhenFullTitleIsBlank(string title)
    {
        var model = new UpdateProgramRequest { FullTitle = title };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.FullTitle);
    }

    [Fact]
    public void UpdateProgram_ShouldHaveError_WhenDegreeLevelIsInvalid()
    {
        var model = new UpdateProgramRequest { DegreeLevel = "INVALID" };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.DegreeLevel);
    }

    [Fact]
    public void UpdateProgram_ShouldHaveError_WhenStatusIsInvalid()
    {
        var model = new UpdateProgramRequest { Status = "INVALID_STATUS" };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Status);
    }

    [Fact]
    public void UpdateProgram_ShouldPass_WhenFieldsAreValid()
    {
        var model = new UpdateProgramRequest
        {
            Name = "Updated CS",
            FullTitle = "Master of Science in Software Engineering",
            DegreeLevel = "MASTER",
            Status = "ACTIVE"
        };

        var result = _updateValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion
}
