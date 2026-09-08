using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;

namespace UniDipVeri.IntegrationTests;

[Collection("PostgreSqlIntegrationCollection")]
public class StaffManagementIntegrationTests : IDisposable
{
    private readonly PostgreSqlTestFixture _fixture;
    private readonly HttpClient _client;
    private readonly IServiceScope _scope;
    private readonly UniDipVeriDbContext _dbContext;
    private readonly IPasswordHasher _passwordHasher;

    private readonly Guid _universityId = Guid.NewGuid();
    private readonly string _adminEmail;
    private readonly string _adminPassword = "SecureAdminPassword123!";
    private readonly string _registrarEmail;
    private readonly string _registrarPassword = "SecureRegistrarPassword123!";
    private Guid _adminId;
    private Guid _registrarId;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public StaffManagementIntegrationTests(PostgreSqlTestFixture fixture)
    {
        _fixture = fixture;
        _client = fixture.Factory.CreateClient();
        _scope = fixture.Factory.Services.CreateScope();
        _dbContext = _scope.ServiceProvider.GetRequiredService<UniDipVeriDbContext>();
        _passwordHasher = _scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        var suffix = Guid.NewGuid().ToString("N")[..8];
        _adminEmail = $"admin_{suffix}@miu.edu";
        _registrarEmail = $"reg_{suffix}@miu.edu";

        SeedTestData(suffix);
    }

    private void SeedTestData(string suffix)
    {
        var university = University.Create($"Uni {suffix}", $"U{suffix}".ToUpperInvariant(), $"{suffix}.miu.edu", id: _universityId);
        _dbContext.Universities.Add(university);

        var adminHash = _passwordHasher.HashPassword(_adminPassword);
        var adminStaff = UniversityStaff.Create(_universityId, "Test Admin", _adminEmail, adminHash, StaffRole.ADMIN);
        _adminId = adminStaff.Id;
        _dbContext.UniversityStaff.Add(adminStaff);

        var registrarHash = _passwordHasher.HashPassword(_registrarPassword);
        var regStaff = UniversityStaff.Create(_universityId, "Test Registrar", _registrarEmail, registrarHash, StaffRole.REGISTRAR);
        _registrarId = regStaff.Id;
        _dbContext.UniversityStaff.Add(regStaff);

        _dbContext.SaveChanges();
    }

    private async Task LoginAsAsync(string email, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/staffs/login", new LoginRequest(email, password));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task StaffManagement_FullVerticalSlice_EndToEndFlow()
    {
        // 1. Unauthenticated request to /api/staffs should return 401
        var unauthResponse = await _client.GetAsync("/api/staffs");
        unauthResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // 2. Log in as Registrar (non-ADMIN) -> access to /api/staffs should return 403 Forbidden
        await LoginAsAsync(_registrarEmail, _registrarPassword);
        var forbiddenResponse = await _client.GetAsync("/api/staffs");
        forbiddenResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 3. Log in as ADMIN
        await LoginAsAsync(_adminEmail, _adminPassword);

        // 4. POST /api/staffs - Create new staff member
        var newStaffEmail = $"new_staff_{Guid.NewGuid():N}@miu.edu";
        var createRequest = new CreateStaffRequest
        {
            Name = "New Approver",
            Email = newStaffEmail,
            Password = "SecureNewPassword123!",
            Roles = ["APPROVER"]
        };
        var createResponse = await _client.PostAsJsonAsync("/api/staffs", createRequest);
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        createResponse.Headers.Location.Should().NotBeNull();

        var createdStaff = await createResponse.Content.ReadFromJsonAsync<StaffResponse>(JsonOptions);
        createdStaff.Should().NotBeNull();
        createdStaff!.Email.Should().Be(newStaffEmail);
        createdStaff.Roles.Should().ContainSingle().Which.Should().Be("APPROVER");
        createdStaff.Status.Should().Be("ACTIVE");
        var createdStaffId = createdStaff.Id;

        // 5. POST /api/staffs with duplicate email returns 409 Conflict
        var dupResponse = await _client.PostAsJsonAsync("/api/staffs", createRequest);
        dupResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);

        // 6. POST /api/staffs with REGISTRAR and APPROVER roles rejected with 400 Bad Request
        var badRoleRequest = new CreateStaffRequest
        {
            Name = "Forbidden Combo",
            Email = $"combo_{Guid.NewGuid():N}@miu.edu",
            Password = "Password123!",
            Roles = ["REGISTRAR", "APPROVER"]
        };
        var badRoleResponse = await _client.PostAsJsonAsync("/api/staffs", badRoleRequest);
        badRoleResponse.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 7. GET /api/staffs - lists staff members
        var listResponse = await _client.GetAsync("/api/staffs");
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var staffList = await listResponse.Content.ReadFromJsonAsync<List<StaffResponse>>(JsonOptions);
        staffList.Should().NotBeNull();
        staffList!.Should().Contain(s => s.Id == createdStaffId);

        // 8. GET /api/staffs/{id} - returns details
        var getResponse = await _client.GetAsync($"/api/staffs/{createdStaffId}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var fetchedStaff = await getResponse.Content.ReadFromJsonAsync<StaffResponse>(JsonOptions);
        fetchedStaff!.Id.Should().Be(createdStaffId);
        fetchedStaff.Name.Should().Be("New Approver");

        // 9. PATCH /api/staffs/{id} - updates profile
        var updateRequest = new UpdateStaffRequest
        {
            Name = "Updated Approver Name"
        };
        var patchResponse = await _client.PatchAsJsonAsync($"/api/staffs/{createdStaffId}", updateRequest);
        patchResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var updatedStaff = await patchResponse.Content.ReadFromJsonAsync<StaffResponse>(JsonOptions);
        updatedStaff!.Name.Should().Be("Updated Approver Name");

        // 10. POST /api/staffs/{id}/deactivate - deactivates staff
        var deactivateResponse = await _client.PostAsync($"/api/staffs/{createdStaffId}/deactivate", null);
        deactivateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var deactivatedStaff = await deactivateResponse.Content.ReadFromJsonAsync<StaffResponse>(JsonOptions);
        deactivatedStaff!.Status.Should().Be("INACTIVE");

        // 11. Deactivated staff cannot log in
        var deactClient = _fixture.Factory.CreateClient();
        var deactLoginResponse = await deactClient.PostAsJsonAsync("/api/staffs/login", new LoginRequest(newStaffEmail, "SecureNewPassword123!"));
        deactLoginResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CannotDeactivate_OrRemoveAdminRole_FromLastRemainingActiveAdmin()
    {
        // Deactivate all other active admins in database so _adminId is the last active admin
        var otherAdmins = _dbContext.UniversityStaff
            .Where(s => s.Id != _adminId && s.Status == StaffStatus.ACTIVE && s.StaffRoles.Any(r => r.Role == StaffRole.ADMIN))
            .ToList();
        foreach (var other in otherAdmins)
        {
            other.Deactivate();
        }
        await _dbContext.SaveChangesAsync();

        // Log in as the only admin in this test scope
        await LoginAsAsync(_adminEmail, _adminPassword);

        // 1. Cannot deactivate the only active admin -> 409 Conflict
        var deactResponse = await _client.PostAsync($"/api/staffs/{_adminId}/deactivate", null);
        deactResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);

        // 2. Cannot remove ADMIN role from the only active admin via PATCH -> 409 Conflict
        var patchRoleResponse = await _client.PatchAsJsonAsync($"/api/staffs/{_adminId}", new UpdateStaffRequest
        {
            Roles = ["REGISTRAR"]
        });
        patchRoleResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    public void Dispose()
    {
        _scope.Dispose();
        _client.Dispose();
    }
}
