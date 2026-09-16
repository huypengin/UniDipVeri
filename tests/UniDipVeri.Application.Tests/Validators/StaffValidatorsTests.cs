using FluentValidation.TestHelper;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Application.Features.Staff.Validators;

namespace UniDipVeri.Application.Tests.Validators;

public class StaffValidatorsTests
{
    private readonly CreateStaffRequestValidator _createValidator = new();
    private readonly UpdateStaffRequestValidator _updateValidator = new();

    #region CreateStaffRequestValidator Tests

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void CreateStaff_ShouldHaveError_WhenNameIsMissingOrWhitespace(string? name)
    {
        var model = new CreateStaffRequest
        {
            Name = name!,
            Email = "staff@miu.edu",
            Password = "Password123!",
            Roles = ["ADMIN"]
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void CreateStaff_ShouldHaveError_WhenEmailIsMissingOrWhitespace(string? email)
    {
        var model = new CreateStaffRequest
        {
            Name = "John Doe",
            Email = email!,
            Password = "Password123!",
            Roles = ["ADMIN"]
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Email);
    }

    [Theory]
    [InlineData("invalid-email")]
    [InlineData("@missinguser.com")]
    [InlineData("user@")]
    public void CreateStaff_ShouldHaveError_WhenEmailFormatIsInvalid(string email)
    {
        var model = new CreateStaffRequest
        {
            Name = "John Doe",
            Email = email,
            Password = "Password123!",
            Roles = ["ADMIN"]
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Email)
            .WithErrorMessage("Invalid email format.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void CreateStaff_ShouldHaveError_WhenPasswordIsMissingOrWhitespace(string? password)
    {
        var model = new CreateStaffRequest
        {
            Name = "John Doe",
            Email = "staff@miu.edu",
            Password = password!,
            Roles = ["ADMIN"]
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Password);
    }

    [Fact]
    public void CreateStaff_ShouldHaveError_WhenRolesIsEmpty()
    {
        var model = new CreateStaffRequest
        {
            Name = "John Doe",
            Email = "staff@miu.edu",
            Password = "Password123!",
            Roles = []
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Roles)
            .WithErrorMessage("At least one staff role must be assigned.");
    }

    [Fact]
    public void CreateStaff_ShouldHaveError_WhenRoleIsInvalid()
    {
        var model = new CreateStaffRequest
        {
            Name = "John Doe",
            Email = "staff@miu.edu",
            Password = "Password123!",
            Roles = ["NOT_A_VALID_ROLE"]
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor("Roles[0]");
    }

    [Fact]
    public void CreateStaff_ShouldPass_WhenRequestIsValid()
    {
        var model = new CreateStaffRequest
        {
            Name = "John Doe",
            Email = "staff@miu.edu",
            Password = "Password123!",
            Roles = ["ADMIN", "REGISTRAR"]
        };

        var result = _createValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion

    #region UpdateStaffRequestValidator Tests

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void UpdateStaff_ShouldHaveError_WhenNameIsProvidedAsWhitespace(string name)
    {
        var model = new UpdateStaffRequest { Name = name };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("invalid-email")]
    public void UpdateStaff_ShouldHaveError_WhenEmailIsInvalid(string email)
    {
        var model = new UpdateStaffRequest { Email = email };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Email);
    }

    [Fact]
    public void UpdateStaff_ShouldHaveError_WhenRolesIsEmptyList()
    {
        var model = new UpdateStaffRequest { Roles = [] };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Roles);
    }

    [Fact]
    public void UpdateStaff_ShouldHaveError_WhenRoleNameIsInvalid()
    {
        var model = new UpdateStaffRequest { Roles = ["INVALID_ROLE"] };
        var result = _updateValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor("Roles[0]");
    }

    [Fact]
    public void UpdateStaff_ShouldPass_WhenFieldsAreValidOrOmitted()
    {
        var model = new UpdateStaffRequest
        {
            Name = "Valid Name",
            Email = "valid@miu.edu",
            Roles = ["REGISTRAR"]
        };

        var result = _updateValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion
}
